import { useEffect, useRef, useState } from 'react';
import mqtt, { MqttClient } from 'mqtt';
import { Student, ChatMessage, RoomState } from './types';

const BROKER_URL = 'wss://broker.emqx.io:8084/mqtt';
const STUN_SERVERS = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

export function useClassroom() {
  const [inRoom, setInRoom] = useState(false);
  const [roomId, setRoomId] = useState('');
  const [myRole, setMyRole] = useState<'teacher' | 'student'>('student');
  const [myNickname, setMyNickname] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const [roomState, setRoomState] = useState<RoomState>({
    roomId: '',
    hostSocketId: '',
    isAllMuted: false,
    whiteboardBackgrounds: [''],
    whiteboardPageNum: 0,
    whiteboardPaths: [],
    students: {},
    chatHistory: [],
  });

  const mqttClientRef = useRef<MqttClient | null>(null);
  const roomIdRef = useRef('');
  const myIdRef = useRef(Math.random().toString(36).substring(2, 9));
  const myStreamRef = useRef<MediaStream | null>(null);
  
  // WebRTC Refs
  const teacherPcsRef = useRef<{ [studentId: string]: RTCPeerConnection }>({});
  const studentPcRef = useRef<RTCPeerConnection | null>(null);
  const teacherDcsRef = useRef<{ [studentId: string]: RTCDataChannel }>({});
  const studentDcRef = useRef<RTCDataChannel | null>(null);
  
  const iceBuffersRef = useRef<{ [peerId: string]: RTCIceCandidateInit[] }>({});
  const chunkBuffersRef = useRef<{ [peerId: string]: { [msgId: string]: { chunks: string[], received: number } } }>({});
  const signalingLockRef = useRef<{ [peerId: string]: boolean }>({});

  const publish = (topic: string, message: any) => {
    if (mqttClientRef.current) {
      mqttClientRef.current.publish(topic, JSON.stringify(message));
    }
  };

  // P2P Data Broadcast with Chunking support and BufferedAmount monitoring
  const CHUNK_SIZE = 16000; // ~16KB per chunk
  const MAX_BUFFERED_AMOUNT = 1 * 1024 * 1024; // 1MB threshold

  const broadcastP2P = (data: any) => {
    if (myRole === 'teacher') {
      (Object.values(teacherDcsRef.current) as RTCDataChannel[]).forEach(dc => {
        if (dc.readyState === 'open') sendLargeData(dc, data);
      });
    } else if (studentDcRef.current?.readyState === 'open') {
      sendLargeData(studentDcRef.current, data);
    }
  };

  const sendToPeer = (peerId: string, data: any) => {
    const dc = myRole === 'teacher' ? teacherDcsRef.current[peerId] : studentDcRef.current;
    if (!dc || dc.readyState !== 'open') return;
    sendLargeData(dc, data);
  };

  const sendLargeData = async (dc: RTCDataChannel, data: any) => {
    const msg = JSON.stringify(data);
    if (msg.length <= CHUNK_SIZE) {
      if (dc.readyState === 'open') dc.send(msg);
      return;
    }

    const msgId = Math.random().toString(36).substring(2, 9);
    const total = Math.ceil(msg.length / CHUNK_SIZE);

    for (let i = 0; i < total; i++) {
      // Monitor buffer to avoid overflow/drop
      while (dc.bufferedAmount > MAX_BUFFERED_AMOUNT) {
        await new Promise(r => setTimeout(r, 50));
        if (dc.readyState !== 'open') return;
      }

      const chunk = msg.substring(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
      const chunkData = JSON.stringify({ type: 'chunk', id: msgId, index: i, total, data: chunk });
      if (dc.readyState === 'open') dc.send(chunkData);
    }
  };

  const createRoom = async () => {
    const newRoomId = Math.floor(100000 + Math.random() * 900000).toString();
    const stream = await acquireMicrophone();
    initMQTT('teacher', '老師', newRoomId, stream);
  };

  const joinRoom = async (rid: string, nickname: string) => {
    const stream = await acquireMicrophone();
    initMQTT('student', nickname, rid, stream);
  };

  const acquireMicrophone = async (): Promise<MediaStream | null> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      myStreamRef.current = stream;
      return stream;
    } catch (err) {
      console.warn("Microphone access denied:", err);
      return null;
    }
  };

  const initMQTT = (role: 'teacher' | 'student', nickname: string, rid: string, stream: MediaStream | null) => {
    setIsConnecting(true);
    setMyRole(role);
    setMyNickname(nickname);
    setRoomId(rid);
    roomIdRef.current = rid;

    const client = mqtt.connect(BROKER_URL);
    mqttClientRef.current = client;

    client.on('connect', () => {
      const baseTopic = `ephemeral-classroom/${rid}`;
      if (role === 'teacher') {
        client.subscribe(`${baseTopic}/join`);
        client.subscribe(`${baseTopic}/signal/${myIdRef.current}`);
        client.subscribe(`${baseTopic}/chat`);
        client.subscribe(`${baseTopic}/control/teacher`);
        setInRoom(true);
        setIsConnecting(false);
        setRoomState(prev => ({ ...prev, roomId: rid, hostSocketId: myIdRef.current }));
      } else {
        client.subscribe([
          `${baseTopic}/lobby_sync`,
          `${baseTopic}/signal/${myIdRef.current}`,
          `${baseTopic}/chat`,
          `${baseTopic}/control/all`,
          `${baseTopic}/control/${myIdRef.current}`
        ], (err) => {
          if (!err) {
            // 延遲發送 join，確保訂閱已生效
            setTimeout(() => {
              publish(`${baseTopic}/join`, { id: myIdRef.current, name: nickname });
            }, 800);
          } else {
            setErrorMsg("MQTT 訂閱失敗");
            setIsConnecting(false);
          }
        });
      }
    });

    client.on('message', (topic, message) => {
      const data = JSON.parse(message.toString());
      const baseTopic = `ephemeral-classroom/${rid}`;

      if (topic === `${baseTopic}/join` && role === 'teacher') {
        // 老師不處理自己的 join
        if (data.id !== myIdRef.current) {
          handleStudentJoin(data.id, data.name);
        }
      } else if (topic === `${baseTopic}/signal/${myIdRef.current}`) {
        handleSignal(data.from, data.signal);
      } else if (topic === `${baseTopic}/lobby_sync` && role === 'student') {
        setRoomState(prev => ({
          ...prev,
          roomId: data.roomId,
          hostSocketId: data.hostSocketId,
          isAllMuted: data.isAllMuted,
          students: data.students || {},
          // 保留本地已經由 P2P 同步過來的白板資料，防止被 MQTT 的空頁面洗掉
          whiteboardBackgrounds: prev.whiteboardBackgrounds.length > 1 || prev.whiteboardBackgrounds[0] !== '' 
            ? prev.whiteboardBackgrounds 
            : data.whiteboardBackgrounds || [''],
          whiteboardPageNum: prev.whiteboardPageNum !== 0 ? prev.whiteboardPageNum : (data.whiteboardPageNum || 0),
          whiteboardPaths: prev.whiteboardPaths.length > 0 ? prev.whiteboardPaths : (data.whiteboardPaths || [])
        }));
        setInRoom(true);
        setIsConnecting(false);
      } else if (topic === `${baseTopic}/chat`) {
        setRoomState(prev => ({ ...prev, chatHistory: [...prev.chatHistory, data].slice(-200) }));
      } else if (topic === `${baseTopic}/control/all` || topic === `${baseTopic}/control/${myIdRef.current}`) {
        handleControl(data);
      } else if (topic === `${baseTopic}/control/teacher` && role === 'teacher') {
        handleTeacherControl(data);
      }
    });
  };

  const handleStudentJoin = async (studentId: string, studentName: string) => {
    // 嚴格防止重複建立連線
    if (teacherPcsRef.current[studentId] && teacherPcsRef.current[studentId].signalingState !== 'closed') {
      console.log(`[WebRTC] Student ${studentId} already in signaling state: ${teacherPcsRef.current[studentId].signalingState}`);
      return;
    }
    
    console.log(`[WebRTC] Initiating connection with ${studentName} (${studentId})`);
    const rid = roomIdRef.current;
    const pc = new RTCPeerConnection(STUN_SERVERS);
    teacherPcsRef.current[studentId] = pc;

    pc.onconnectionstatechange = () => {
      console.log(`[WebRTC Teacher] PeerConnection state with ${studentId}: ${pc.connectionState}`);
    };
    pc.oniceconnectionstatechange = () => {
      console.log(`[WebRTC Teacher] ICE Connection state with ${studentId}: ${pc.iceConnectionState}`);
    };
    pc.onsignalingstatechange = () => {
      console.log(`[WebRTC Teacher] Signaling state with ${studentId}: ${pc.signalingState}`);
    };

    // 清理可能殘留的鎖
    signalingLockRef.current[studentId] = false;

    // Create DataChannel for Whiteboard
    const dc = pc.createDataChannel('whiteboard_sync', { ordered: true });
    teacherDcsRef.current[studentId] = dc;
    setupDataChannel(dc, studentId);

    if (myStreamRef.current) {
      myStreamRef.current.getTracks().forEach(track => pc.addTrack(track, myStreamRef.current!));
    }

    // 2. 注入電子白板 Canvas 視訊軌 (改用 addTransceiver 強制控制方向)
    const canvasElement = document.getElementById("classroom-interactive-canvas") as HTMLCanvasElement;
    if (canvasElement) {
      try {
        // 每秒捕捉 15 幀（對電子白板來說 15fps 就非常絲滑，且極省頻寬）
        const canvasStream = (canvasElement as any).captureStream(15);
        const videoTrack = canvasStream.getVideoTracks()[0];
        if (videoTrack) {
          console.log(`[WebRTC] Successfully captured whiteboard canvas track for student ${studentId}`);
          
          // 🟢 關鍵修正：不使用 addTrack，直接改用 addTransceiver，並指定方向為 sendonly
          pc.addTransceiver(videoTrack, {
            direction: 'sendonly',
            streams: [canvasStream]
          });

          // 🔥 關鍵修正：強迫 Canvas 進行一次微小的重繪，激活 captureStream 的首幀發送
          const ctx = canvasElement.getContext('2d');
          if (ctx) {
            // 稍微點一個看不見的透明點，或者重繪目前畫布，逼 Canvas 核心發送畫面
            ctx.fillStyle = "rgba(0,0,0,0.01)";
            ctx.fillRect(0, 0, 1, 1);
            console.log("[WebRTC] Triggered canvas repaint heartbeat for WebRTC track activation.");
          }
        }
      } catch (e) {
        console.error("[WebRTC] Failed to capture canvas stream:", e);
      }
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        publish(`ephemeral-classroom/${rid}/signal/${studentId}`, { from: myIdRef.current, signal: { type: 'candidate', candidate: event.candidate } });
      }
    };

    // 🟢 關鍵修正：微調時序，等待 100ms 讓 Canvas 視訊軌完成初始化並被 RTCPeerConnection 正式捕獲
    await new Promise(r => setTimeout(r, 100));

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    publish(`ephemeral-classroom/${rid}/signal/${studentId}`, { from: myIdRef.current, signal: { type: 'offer', sdp: offer } });

    setRoomState(prev => {
      const newState = {
        ...prev,
        students: { ...prev.students, [studentId]: { id: studentId, name: studentName, isMuted: prev.isAllMuted, isHandUp: false, canSpeak: !prev.isAllMuted } }
      };
      // For lobby_sync via MQTT, we strip out heavy background images to stay under broker limits
      const syncState = { ...newState, whiteboardBackgrounds: [''] };
      publish(`ephemeral-classroom/${rid}/lobby_sync`, syncState);
      return newState;
    });
  };

  const handleSignal = async (from: string, signal: any) => {
    const rid = roomIdRef.current;
    let pc = myRole === 'teacher' ? teacherPcsRef.current[from] : (studentPcRef.current || createStudentPC(from));
    if (!pc) return;

    // 防止並行處理同一個 peer 的信令
    if (signalingLockRef.current[from]) {
      setTimeout(() => handleSignal(from, signal), 50);
      return;
    }

    try {
      signalingLockRef.current[from] = true;

      if (signal.type === 'offer') {
        // 如果已經是 stable 且已有遠端描述，代表連線已建立，忽略重複的 offer
        if (pc.signalingState === 'stable' && pc.remoteDescription) {
          console.log("[WebRTC] Already stable, ignoring redundant offer.");
          return;
        }
        await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        publish(`ephemeral-classroom/${rid}/signal/${from}`, { from: myIdRef.current, signal: { type: 'answer', sdp: answer } });
        processIceBuffer(from, pc);
      } else if (signal.type === 'answer') {
        // 只有在 have-local-offer 狀態下才處理 answer
        if (pc.signalingState === 'have-local-offer') {
          await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
          processIceBuffer(from, pc);
        } else {
          console.log("[WebRTC] Ignoring answer in state:", pc.signalingState);
        }
      } else if (signal.type === 'candidate') {
        if (pc.remoteDescription) {
          await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
        } else {
          if (!iceBuffersRef.current[from]) iceBuffersRef.current[from] = [];
          iceBuffersRef.current[from].push(signal.candidate);
        }
      }
    } catch (err) {
      console.warn("[WebRTC] Signal Handling Error:", err);
    } finally {
      signalingLockRef.current[from] = false;
    }
  };

  const createStudentPC = (teacherId: string) => {
    const rid = roomIdRef.current;
    const pc = new RTCPeerConnection(STUN_SERVERS);
    studentPcRef.current = pc;

    pc.onconnectionstatechange = () => {
      console.log(`[WebRTC Student] PeerConnection state: ${pc.connectionState}`);
    };
    pc.oniceconnectionstatechange = () => {
      console.log(`[WebRTC Student] ICE Connection state: ${pc.iceConnectionState}`);
    };
    pc.onsignalingstatechange = () => {
      console.log(`[WebRTC Student] Signaling state: ${pc.signalingState}`);
    };

    pc.ondatachannel = (event) => {
      console.log(`[WebRTC Student] ondatachannel triggered! Channel name: ${event.channel.label}`);
      // 先賦值再執行 setup，確保 setup 內的 sendToPeer 找得到 dc
      studentDcRef.current = event.channel;
      setupDataChannel(event.channel, teacherId);
    };

    // 1. 注入學生的音訊軌
    if (myStreamRef.current) {
      myStreamRef.current.getTracks().forEach(track => pc.addTrack(track, myStreamRef.current!));
    }



    pc.onicecandidate = (event) => {
      if (event.candidate) {
        publish(`ephemeral-classroom/${rid}/signal/${teacherId}`, { from: myIdRef.current, signal: { type: 'candidate', candidate: event.candidate } });
      }
    };

    pc.ontrack = (event) => {
      console.log(`[WebRTC] Received remote track: ${event.track.kind}`);
      
      if (event.track.kind === 'audio') {
        // 綁定老師的聲音
        const remoteAudio = document.getElementById("classroom-teacher-voice") as HTMLAudioElement;
        if (remoteAudio) remoteAudio.srcObject = event.streams[0];
      } 
      else if (event.track.kind === 'video') {
        // 🟢 新增修改：綁定老師的白板視訊畫面
        const remoteVideo = document.getElementById("classroom-student-video-whiteboard") as HTMLVideoElement;
        if (remoteVideo) {
          remoteVideo.srcObject = event.streams[0];
        }
      }
    };
    return pc;
  };

  const setupDataChannel = (dc: RTCDataChannel, peerId: string) => {
    console.log(`[P2P] setupDataChannel called for ${peerId}. Initial readyState: ${dc.readyState}`);
    const handleOpen = () => {
      console.log(`[P2P] DataChannel with ${peerId} is now OPEN`);
      if (myRole === 'student') {
        // 確保通道穩定後才發送
        setTimeout(() => {
          if (dc.readyState === 'open') {
            console.log(`[P2P] Sending request_init_state to ${peerId}`);
            sendToPeer(peerId, { type: 'request_init_state' });
          }
        }, 800);
      }
    };

    dc.onopen = handleOpen;

    // 🔥 關鍵修復：如果 DataChannel 在註冊時就已經是 open 狀態，手動觸發 handleOpen 避免漏接事件
    if (dc.readyState === 'open') {
      console.log(`[P2P] DataChannel was already OPEN upon setup for ${peerId}`);
      handleOpen();
    }

    dc.onclose = () => {
      console.warn(`[P2P] DataChannel with ${peerId} CLOSED`);
    };

    dc.onerror = (err) => {
      console.error(`[P2P] DataChannel ERROR with ${peerId}:`, err);
    };

    dc.onmessage = (event) => {
      let data = JSON.parse(event.data);

      if (data.type === 'chunk') {
        const { id, index, total, data: chunkData } = data;
        if (!chunkBuffersRef.current[peerId]) chunkBuffersRef.current[peerId] = {};
        if (!chunkBuffersRef.current[peerId][id]) {
          chunkBuffersRef.current[peerId][id] = { chunks: new Array(total).fill(null), received: 0 };
        }
        
        const buffer = chunkBuffersRef.current[peerId][id];
        if (buffer.chunks[index] === null) {
          buffer.chunks[index] = chunkData;
          buffer.received++;
          
          if (buffer.received % 50 === 0 || buffer.received === total) {
            console.log(`[P2P] Receiving chunks: ${buffer.received}/${total}`);
          }
        }

        // Check if all chunks arrived
        if (buffer.received === total) {
          const fullMsg = buffer.chunks.join('');
          delete chunkBuffersRef.current[peerId][id];
          data = JSON.parse(fullMsg);
        } else {
          return; // Wait for more chunks
        }
      }

      if (data.type === 'request_init_state' && myRole === 'teacher') {
        console.log("[P2P] Teacher received request_init_state, sending full state...");
        // Teacher responds with full state (including backgrounds)
        setRoomState(current => {
          const syncData = {
            type: 'whiteboard_update',
            payload: {
              whiteboardBackgrounds: current.whiteboardBackgrounds,
              whiteboardPageNum: current.whiteboardPageNum,
              whiteboardPaths: current.whiteboardPaths
            }
          };
          sendToPeer(peerId, syncData);
          return current;
        });
      } else if (data.type === 'whiteboard_update') {
        console.log("[P2P] Received whiteboard_update", data.payload);
        setRoomState(prev => ({
          ...prev,
          whiteboardBackgrounds: data.payload.whiteboardBackgrounds || [''],
          whiteboardPageNum: data.payload.whiteboardPageNum ?? 0,
          whiteboardPaths: data.payload.whiteboardPaths || []
        }));
      } else if (data.type === 'draw') {
        setRoomState(prev => {
          const batch = Array.isArray(data.payload) ? data.payload : [data.payload];
          return { ...prev, whiteboardPaths: [...prev.whiteboardPaths, ...batch].slice(-5000) };
        });
      } else if (data.type === 'chat_file') {
        console.log("[P2P] Received chat_file message", data.payload);
        const fileMsg = data.payload;
        setRoomState(prev => ({
          ...prev,
          chatHistory: [...prev.chatHistory, fileMsg].slice(-200)
        }));

        // 老師端角色：協助星狀拓撲路由轉發，將學生的檔案轉發給其他所有學生
        if (myRole === 'teacher') {
          (Object.entries(teacherDcsRef.current) as [string, RTCDataChannel][]).forEach(([studentId, studentDc]) => {
            if (studentId !== peerId && studentDc.readyState === 'open') {
              sendLargeData(studentDc, { type: 'chat_file', payload: fileMsg });
            }
          });
        }
      }
    };
  };

  const processIceBuffer = async (peerId: string, pc: RTCPeerConnection) => {
    const buffer = iceBuffersRef.current[peerId];
    if (buffer) {
      while (buffer.length > 0) {
        const candidate = buffer.shift();
        if (candidate) await pc.addIceCandidate(new RTCIceCandidate(candidate));
      }
    }
  };

  const updateWhiteboard = (data: any) => {
    const whiteboardUpdate = {
      whiteboardBackgrounds: data.whiteboardBackgrounds,
      whiteboardPageNum: data.whiteboardPageNum,
      whiteboardPaths: data.whiteboardPaths
    };
    // Sync via P2P
    broadcastP2P({ type: 'whiteboard_update', payload: whiteboardUpdate });
    // Local Update
    setRoomState(prev => ({ ...prev, ...whiteboardUpdate }));
  };

  const broadcastDraw = (pathDeltaOrBatch: any) => {
    // Sync via P2P
    broadcastP2P({ type: 'draw', payload: pathDeltaOrBatch });
    // Update local teacher state so it persists during re-renders
    setRoomState(prev => {
      const batch = Array.isArray(pathDeltaOrBatch) ? pathDeltaOrBatch : [pathDeltaOrBatch];
      return { 
        ...prev, 
        whiteboardPaths: [...prev.whiteboardPaths, ...batch].slice(-5000) 
      };
    });
  };

  const sendChatMessage = (content: string, type: 'text' | 'file' = 'text', fileData?: any) => {
    const msg: ChatMessage = { id: Math.random().toString(36).substring(2, 9), senderId: myIdRef.current, senderName: myNickname, role: myRole, content, timestamp: Date.now(), type, fileData };
    
    if (type === 'file') {
      // 檔案分享：不透過 MQTT，改以 WebRTC DataChannel (P2P) 直連分片傳送
      setRoomState(prev => ({ ...prev, chatHistory: [...prev.chatHistory, msg].slice(-200) }));
      
      if (myRole === 'teacher') {
        broadcastP2P({ type: 'chat_file', payload: msg });
      } else {
        if (studentDcRef.current?.readyState === 'open') {
          sendLargeData(studentDcRef.current, { type: 'chat_file', payload: msg });
        } else {
          console.warn("[WebRTC] DataChannel not open, file send ignored");
        }
      }
    } else {
      publish(`ephemeral-classroom/${roomIdRef.current}/chat`, msg);
    }
  };

  const toggleMuteAll = (mute: boolean) => {
    if (myRole !== 'teacher') return;
    publish(`ephemeral-classroom/${roomIdRef.current}/control/all`, { type: 'mute-all', mute });
  };

  const toggleHandUp = (isHandUp: boolean) => {
    if (myRole !== 'student') return;
    publish(`ephemeral-classroom/${roomIdRef.current}/control/teacher`, { type: 'hand-up', studentId: myIdRef.current, isHandUp });
  };

  const allowSpeak = (studentId: string, canSpeak: boolean) => {
    if (myRole !== 'teacher') return;
    publish(`ephemeral-classroom/${roomIdRef.current}/control/all`, { type: 'speak-status', studentId, canSpeak, isHandUp: false });
  };

  const handleControl = (data: any) => {
    if (data.type === 'mute-all') setRoomState(prev => ({ ...prev, isAllMuted: data.mute }));
    else if (data.type === 'speak-status') setRoomState(prev => ({ ...prev, students: { ...prev.students, [data.studentId]: { ...prev.students[data.studentId], canSpeak: data.canSpeak, isHandUp: data.isHandUp } } }));
  };

  const handleTeacherControl = (data: any) => {
    if (data.type === 'hand-up') setRoomState(prev => ({ ...prev, students: { ...prev.students, [data.studentId]: { ...prev.students[data.studentId], isHandUp: data.isHandUp } } }));
  };

  const disconnect = () => {
    if (mqttClientRef.current) mqttClientRef.current.end();
    Object.values(teacherPcsRef.current).forEach((pc: any) => pc.close());
    if (studentPcRef.current) studentPcRef.current.close();
    if (myStreamRef.current) myStreamRef.current.getTracks().forEach(t => t.stop());
    setInRoom(false);
  };

  return { inRoom, roomId, myRole, myNickname, isConnecting, errorMsg, roomState, createRoom, joinRoom, sendChatMessage, updateWhiteboard, broadcastDraw, toggleMuteAll, toggleHandUp, allowSpeak, disconnect, myStreamRef };
}
