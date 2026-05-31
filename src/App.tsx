import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Users, 
  Mic, 
  MicOff, 
  Hand, 
  Volume2, 
  VolumeX, 
  QrCode, 
  LogOut, 
  Share2, 
  Send, 
  FileUp, 
  FileDown, 
  MessageSquare, 
  Activity, 
  Check, 
  ShieldAlert,
  GraduationCap
} from "lucide-react";

import JoinPage from "./components/JoinPage";
import Whiteboard from "./components/Whiteboard";
import { Student } from "./types";
import { useClassroom } from "./useClassroom";

export default function App() {
  const {
    inRoom,
    roomId,
    myRole,
    myNickname,
    isConnecting,
    errorMsg,
    roomState,
    createRoom,
    joinRoom,
    sendChatMessage,
    updateWhiteboard,
    toggleMuteAll,
    toggleHandUp,
    allowSpeak,
    disconnect,
    myStreamRef
  } = useClassroom();

  // UI state
  const [chatInput, setChatInput] = useState<string>("");
  const [showQrModal, setShowQrModal] = useState<boolean>(false);
  const [micState, setMicState] = useState<"granted" | "denied" | "pending">("pending");
  const [localMute, setLocalMute] = useState<boolean>(false);
  const [localHandUp, setLocalHandUp] = useState<boolean>(false);
  const [voiceVolume, setVoiceVolume] = useState<number>(0);

  // Audio evaluation level meter hook
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);

  // Auto scroll chats container
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [roomState.chatHistory]);

  useEffect(() => {
    if (inRoom && myStreamRef.current) {
      setMicState("granted");
      startAudioAnalyser(myStreamRef.current);
    } else {
      stopAudioAnalyser();
    }
  }, [inRoom, myStreamRef.current]);

  // Evaluate voice audio volume waves
  const startAudioAnalyser = (stream: MediaStream) => {
    try {
      if (audioContextRef.current) audioContextRef.current.close();
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 32;
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);

      audioContextRef.current = audioContext;
      analyserRef.current = analyser;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const checkVolume = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);
        let sum = 0;
        dataArray.forEach((val) => { sum += val; });
        const average = sum / dataArray.length;
        setVoiceVolume(Math.min(100, Math.round((average / 128) * 100)));
        rafRef.current = requestAnimationFrame(checkVolume);
      };
      rafRef.current = requestAnimationFrame(checkVolume);
    } catch (e) {
      console.warn("Audio Context Analyzer initiation failed:", e);
    }
  };

  const stopAudioAnalyser = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
    }
    setVoiceVolume(0);
  };

  // Configure Track enabled status when local mute switches
  useEffect(() => {
    if (myStreamRef.current) {
      myStreamRef.current.getAudioTracks().forEach((track) => {
        track.enabled = !localMute;
      });
    }
  }, [localMute, myStreamRef.current]);

  // Handle students being muted by teacher
  useEffect(() => {
    if (myRole === "student" && roomState.isAllMuted) {
      setLocalMute(true);
    }
  }, [roomState.isAllMuted, myRole]);

  const handleMuteAllToggle = () => {
    toggleMuteAll(!roomState.isAllMuted);
  };

  const handleHandUpToggle = () => {
    const offset = !localHandUp;
    setLocalHandUp(offset);
    toggleHandUp(offset);
  };

  const handleAllowStudentSpeak = (studentSocketId: string, currentCanSpeak: boolean) => {
    allowSpeak(studentSocketId, !currentCanSpeak);
  };

  const handleWhiteboardDraw = (data: any) => {
    if (myRole !== "teacher") return;
    broadcastDraw(data);
  };

  const handleWhiteboardClear = () => {
    if (myRole !== "teacher") return;
    updateWhiteboard({ ...roomState, whiteboardPaths: [] });
  };

  const handleWhiteboardPageChange = (pageNum: number, backgrounds?: string[]) => {
    if (myRole !== "teacher") return;
    const nextBgs = backgrounds || roomState.whiteboardBackgrounds;
    updateWhiteboard({ 
      ...roomState, 
      whiteboardPageNum: pageNum, 
      whiteboardBackgrounds: nextBgs, 
      whiteboardPaths: [] 
    });
  };

  const handleDownloadAttendance = () => {
    const list: Student[] = Object.values(roomState.students) as Student[];
    let csvContent = "\uFEFF座號,學生學號/暱稱,當前聯網狀態,授課發言權限,是否正在舉手,點名存檔時間\n";
    if (list.length === 0) {
      csvContent += "1,無人在線學員,-,-,-,-\n";
    } else {
      list.forEach((st, idx) => {
        csvContent += `${idx + 1},"${st.name.replace(/"/g, '""')}",在線 (Online),${st.canSpeak ? "允許發言" : "靜音管制"},${st.isHandUp ? "是" : "否"},"${new Date().toLocaleString("zh-TW")}"\n`;
      });
    }
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.setAttribute("download", `點名冊_${roomState.roomId}_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleSendTextMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    sendChatMessage(chatInput.trim());
    setChatInput("");
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const file = e.target.files[0];
    if (file.size > 5 * 1024 * 1024) {
      alert("請選擇小於 5MB 的檔案！");
      return;
    }
    const reader = new FileReader();
    reader.onload = (event) => {
      sendChatMessage(`分享了檔案： ${file.name}`, "file", { name: file.name, size: file.size, type: file.type, dataUrl: event.target?.result as string });
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const studentsList: Student[] = Object.values(roomState.students) as Student[];
  const joinUrl = `${window.location.origin}${window.location.pathname}?room=${roomId}`;

  if (!inRoom) {
    return (
      <JoinPage 
        onCreateRoom={createRoom}
        onJoinRoom={joinRoom}
        isConnecting={isConnecting}
        errorMsg={errorMsg}
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col antialiased font-sans selection:bg-indigo-500 selection:text-white">
      <audio id="classroom-teacher-voice" autoPlay className="hidden" />
      <header className="h-14 border-b border-slate-700/50 bg-slate-950/50 flex items-center justify-between px-6 shrink-0 z-25 sticky top-0 backdrop-blur-md">
        <div className="flex items-center gap-4">
          <div className="w-8 h-8 bg-indigo-500 rounded-lg flex items-center justify-center font-bold text-white shadow-lg shadow-indigo-500/20">V</div>
          <div>
            <h1 className="text-sm font-semibold text-white leading-none uppercase tracking-wide">
              VIBE CLASSROOM <span className="text-slate-500 font-normal ml-2 italic font-mono">#{roomId}</span>
            </h1>
            <p className="text-[9px] text-indigo-400 font-mono mt-1 tracking-wider uppercase">ROLE: {myRole === "teacher" ? "TEACHER_HOST" : "STUDENT"}</p>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 font-mono">LIVE P2P</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowQrModal(true)} className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 rounded font-mono text-[10px] uppercase font-semibold text-slate-300 border border-slate-800 transition-all cursor-pointer">Share QR</button>
            <button onClick={disconnect} className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 rounded text-xs font-medium text-white shadow-lg shadow-indigo-500/20 transition-all cursor-pointer border border-indigo-500/35">離班 Exit</button>
          </div>
        </div>
      </header>

      <main className="flex-1 w-full max-w-7xl mx-auto p-4 grid grid-cols-1 lg:grid-cols-12 gap-4 overflow-hidden">
        <section className="lg:col-span-8 flex flex-col gap-4 overflow-y-auto">
          <Whiteboard
            isHost={myRole === "teacher"}
            backgrounds={roomState.whiteboardBackgrounds}
            pageNum={roomState.whiteboardPageNum}
            paths={roomState.whiteboardPaths}
            onDraw={handleWhiteboardDraw}
            onClear={handleWhiteboardClear}
            onPageChange={handleWhiteboardPageChange}
          />
          <div className="h-8 bg-slate-950/80 border border-slate-800/80 rounded-lg flex items-center px-4 justify-between shrink-0 font-mono text-[10px]">
            <span className="text-indigo-400 font-bold italic">MQTT_WEBRTC_SECURE_CHANNEL</span>
            <span className="text-slate-500 text-[9px]">SERVERLESS_INFRASTRUCTURE</span>
          </div>
        </section>

        <section className="lg:col-span-4 flex flex-col gap-4 overflow-hidden">
          <div className="bg-slate-950/40 border border-slate-800/85 p-4 rounded-xl shadow-lg flex flex-col gap-3">
            <div className="flex items-center justify-between pb-1 border-b border-slate-800/30">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">在線成員 ({studentsList.length + 1})</span>
              {myRole === "teacher" && (
                <button onClick={handleMuteAllToggle} className={`px-2 py-1 rounded text-[10px] font-bold border font-mono transition-all uppercase cursor-pointer ${roomState.isAllMuted ? "bg-rose-500/10 border-rose-500/30 text-rose-400 hover:bg-rose-500/20" : "bg-indigo-600/10 border-indigo-500/30 text-indigo-300 hover:bg-indigo-500/20"}`}>
                  {roomState.isAllMuted ? "🔓 解除靜音" : "🚫 全體靜音"}
                </button>
              )}
            </div>
            {myRole === "teacher" && (
              <button onClick={handleDownloadAttendance} className="flex items-center justify-center gap-1.5 p-2 bg-slate-900 hover:bg-slate-850 border border-slate-800 rounded text-[10px] font-semibold text-indigo-300 cursor-pointer transition-all">
                <FileDown size={11} className="text-emerald-400" />
                <span>📤 下載點名冊 (CSV)</span>
              </button>
            )}
            <div className="flex flex-col gap-1.5 max-h-[170px] overflow-y-auto pr-1">
              <div className="flex items-center justify-between p-2 bg-indigo-550/5 border border-indigo-500/20 rounded">
                <span className="text-xs font-semibold text-slate-200">授課老師 (Host)</span>
                <div className="flex gap-0.5 h-3 items-end">
                  <span className="w-0.5 bg-indigo-400 rounded-sm" style={{ height: myRole === "teacher" && !localMute ? `${Math.max(20, voiceVolume)}%` : "20%" }} />
                  <span className="w-0.5 bg-indigo-400 rounded-sm animate-pulse" style={{ height: myRole === "teacher" && !localMute ? `${Math.max(40, voiceVolume * 0.8)}%` : "10%" }} />
                </div>
              </div>
              {studentsList.map((st) => (
                <div key={st.id} className={`flex items-center justify-between p-2 rounded transition-all ${st.isHandUp ? "bg-amber-500/10 border border-amber-500/30" : "bg-slate-900/40 border border-slate-800/60"}`}>
                  <span className="text-xs font-medium text-slate-300">{st.name} {st.isHandUp && "✋"}</span>
                  {myRole === "teacher" && (
                    <button onClick={() => handleAllowStudentSpeak(st.id, st.canSpeak)} className={`text-[9px] font-bold px-2 py-1 rounded border ${st.canSpeak ? "bg-emerald-550/10 text-emerald-400" : "bg-amber-550/10 text-amber-400"}`}>
                      {st.canSpeak ? "MUTE" : "ALLOW"}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="bg-slate-950/40 border border-slate-800/80 p-4 rounded-xl shadow-lg flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setLocalMute(!localMute)} className={`flex items-center justify-center gap-1.5 py-2.5 rounded font-mono text-[11px] font-bold border cursor-pointer ${localMute ? "bg-rose-500/10 text-rose-400" : "bg-indigo-600/10 text-indigo-400"}`}>
                {localMute ? <MicOff size={12} /> : <Mic size={12} />}
                <span>{localMute ? "MUTED" : "MIC_ON"}</span>
              </button>
              {myRole === "student" && (
                <button onClick={handleHandUpToggle} className={`flex items-center justify-center gap-1.5 py-2.5 rounded font-mono text-[11px] font-bold border cursor-pointer ${localHandUp ? "bg-amber-505/10 text-amber-300 animate-pulse" : "bg-slate-900 text-slate-300"}`}>
                  <Hand size={12} />
                  <span>{localHandUp ? "RAISED" : "HAND_UP"}</span>
                </button>
              )}
            </div>
          </div>

          <div className="bg-slate-950/40 border border-slate-800/80 rounded-xl shadow-lg overflow-hidden flex-1 flex flex-col min-h-[220px]">
            <div className="px-4 py-2.5 bg-slate-950/30 border-b border-slate-800/80 flex items-center justify-between">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest font-mono">即時聊天</span>
            </div>
            <div className="flex-1 overflow-y-auto p-3.5 flex flex-col gap-2 max-h-[300px]">
              {roomState.chatHistory.map((m) => (
                <div key={m.id} className={`flex flex-col max-w-[85%] rounded px-2.5 py-1.5 text-[11px] border ${m.role === "teacher" ? "bg-indigo-500/5 mr-auto" : "bg-slate-900/60 ml-auto"}`}>
                  <span className="text-[9px] font-bold text-slate-500">{m.senderName}</span>
                  {m.type === "file" ? (
                    <a href={m.fileData?.dataUrl} download={m.fileData?.name} className="text-indigo-400 font-bold underline">📎 {m.fileData?.name}</a>
                  ) : (
                    <p className="text-slate-300 break-words">{m.content}</p>
                  )}
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
            <form onSubmit={handleSendTextMessage} className="p-2 bg-slate-950/40 border-t border-slate-800/80 flex items-center gap-1.5">
              <label className="p-1.5 cursor-pointer bg-slate-900 text-slate-500 border border-slate-800 rounded">
                <FileUp size={13} />
                <input type="file" onChange={handleFileUpload} className="hidden" />
              </label>
              <input type="text" placeholder="Message..." value={chatInput} onChange={(e) => setChatInput(e.target.value)} className="flex-1 bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-white" />
              <button type="submit" className="p-1.5 bg-slate-900 text-slate-400 rounded"><Send size={13} /></button>
            </form>
          </div>
        </section>
      </main>

      {showQrModal && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-slate-800 w-full max-w-sm rounded-2xl border border-slate-700 p-6 flex flex-col items-center">
            <h3 className="text-sm font-bold text-white mb-4">掃碼加入課堂</h3>
            <div className="bg-white p-3 rounded-2xl mb-6">
              <img src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(joinUrl)}`} alt="QR" className="w-44 h-44" />
            </div>
            <div className="w-full flex gap-2 items-center bg-slate-900 rounded-xl p-2.5 border border-slate-700 text-[10px] text-slate-300 mb-6">
              <span className="flex-1 truncate">{joinUrl}</span>
              <button onClick={() => { navigator.clipboard.writeText(joinUrl); alert("已複製！"); }} className="px-2 py-1 bg-slate-750 text-teal-400 rounded">複製</button>
            </div>
            <button onClick={() => setShowQrModal(false)} className="w-full py-2 bg-slate-700 text-white text-xs font-bold rounded-xl">關閉</button>
          </div>
        </div>
      )}
    </div>
  );
}
