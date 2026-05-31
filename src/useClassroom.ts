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

  const publish = (topic: string, message: any) => {
    if (mqttClientRef.current) {
      mqttClientRef.current.publish(topic, JSON.stringify(message));
    }
  };

  // P2P Data Broadcast
  const broadcastP2P = (data: any) => {
    const msg = JSON.stringify(data);
    if (myRole === 'teacher') {
      Object.values(teacherDcsRef.current).forEach(dc => {
        if (dc.readyState === 'open') dc.send(msg);
      });
    } else if (studentDcRef.current?.readyState === 'open') {
      studentDcRef.current.send(msg);
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
            setTimeout(() => publish(`${baseTopic}/join`, { id: myIdRef.current, name: nickname }), 500);
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
        handleStudentJoin(data.id, data.name);
      } else if (topic === `${baseTopic}/signal/${myIdRef.current}`) {
        handleSignal(data.from, data.signal);
      } else if (topic === `${baseTopic}/lobby_sync` && role === 'student') {
        setRoomState(data);
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
    const rid = roomIdRef.current;
    const pc = new RTCPeerConnection(STUN_SERVERS);
    teacherPcsRef.current[studentId] = pc;

    // Create DataChannel for Whiteboard
    const dc = pc.createDataChannel('whiteboard_sync', { ordered: true });
    teacherDcsRef.current[studentId] = dc;
    setupDataChannel(dc);

    if (myStreamRef.current) {
      myStreamRef.current.getTracks().forEach(track => pc.addTrack(track, myStreamRef.current!));
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        publish(`ephemeral-classroom/${rid}/signal/${studentId}`, { from: myIdRef.current, signal: { type: 'candidate', candidate: event.candidate } });
      }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    publish(`ephemeral-classroom/${rid}/signal/${studentId}`, { from: myIdRef.current, signal: { type: 'offer', sdp: offer } });

    setRoomState(prev => {
      const newState = {
        ...prev,
        students: { ...prev.students, [studentId]: { id: studentId, name: studentName, isMuted: prev.isAllMuted, isHandUp: false, canSpeak: !prev.isAllMuted } }
      };
      publish(`ephemeral-classroom/${rid}/lobby_sync`, newState);
      return newState;
    });
  };

  const handleSignal = async (from: string, signal: any) => {
    const rid = roomIdRef.current;
    let pc = myRole === 'teacher' ? teacherPcsRef.current[from] : (studentPcRef.current || createStudentPC(from));
    if (!pc) return;

    try {
      if (signal.type === 'offer') {
        await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        publish(`ephemeral-classroom/${rid}/signal/${from}`, { from: myIdRef.current, signal: { type: 'answer', sdp: answer } });
        processIceBuffer(from, pc);
      } else if (signal.type === 'answer') {
        await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        processIceBuffer(from, pc);
      } else if (signal.type === 'candidate') {
        if (pc.remoteDescription) await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
        else {
          if (!iceBuffersRef.current[from]) iceBuffersRef.current[from] = [];
          iceBuffersRef.current[from].push(signal.candidate);
        }
      }
    } catch (err) { console.warn("WebRTC Signal Error", err); }
  };

  const createStudentPC = (teacherId: string) => {
    const rid = roomIdRef.current;
    const pc = new RTCPeerConnection(STUN_SERVERS);
    studentPcRef.current = pc;

    pc.ondatachannel = (event) => {
      studentDcRef.current = event.channel;
      setupDataChannel(event.channel);
    };

    if (myStreamRef.current) {
      myStreamRef.current.getTracks().forEach(track => pc.addTrack(track, myStreamRef.current!));
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        publish(`ephemeral-classroom/${rid}/signal/${teacherId}`, { from: myIdRef.current, signal: { type: 'candidate', candidate: event.candidate } });
      }
    };

    pc.ontrack = (event) => {
      const remoteAudio = document.getElementById("classroom-teacher-voice") as HTMLAudioElement;
      if (remoteAudio) remoteAudio.srcObject = event.streams[0];
    };
    return pc;
  };

  const setupDataChannel = (dc: RTCDataChannel) => {
    dc.onopen = () => {
      console.log("[P2P] DataChannel Opened");
      // If student, teacher might want to send current page immediately
      if (myRole === 'teacher') {
        // We'll handle this in the broadcast
      }
    };
    dc.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'whiteboard_update') {
        setRoomState(prev => ({ ...prev, ...data.payload }));
      } else if (data.type === 'draw') {
        setRoomState(prev => ({ ...prev, whiteboardPaths: [...prev.whiteboardPaths, data.payload] }));
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

  const broadcastDraw = (pathDelta: any) => {
    broadcastP2P({ type: 'draw', payload: pathDelta });
  };

  const sendChatMessage = (content: string, type: 'text' | 'file' = 'text', fileData?: any) => {
    const msg: ChatMessage = { id: Math.random().toString(36).substring(2, 9), senderId: myIdRef.current, senderName: myNickname, role: myRole, content, timestamp: Date.now(), type, fileData };
    publish(`ephemeral-classroom/${roomIdRef.current}/chat`, msg);
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
