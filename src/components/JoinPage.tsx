import React, { useState, useEffect } from "react";
import { Sparkles, User, Key, Users, BookOpen } from "lucide-react";

interface JoinPageProps {
  onCreateRoom: () => void;
  onJoinRoom: (roomId: string, name: string) => void;
  isConnecting: boolean;
  errorMsg: string;
}

export default function JoinPage({
  onCreateRoom,
  onJoinRoom,
  isConnecting,
  errorMsg,
}: JoinPageProps) {
  const [roomIdInput, setRoomIdInput] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [role, setRole] = useState<"student" | "teacher">("student");

  // Read room ID from URL query parameter
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const rid = params.get("room");
    if (rid && rid.length === 6 && !isNaN(Number(rid))) {
      setRoomIdInput(rid);
      setRole("student");
    }
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // 解鎖瀏覽器音訊限制 (Autoplay Policy)
    const AudioContextClass = (window.AudioContext || (window as any).webkitAudioContext);
    if (AudioContextClass) {
      const dummyCtx = new AudioContextClass();
      if (dummyCtx.state === 'suspended') {
        dummyCtx.resume();
      }
    }

    if (role === "student") {
      if (!roomIdInput || roomIdInput.length !== 6 || isNaN(Number(roomIdInput))) {
        alert("請輸入有效的 6 位數課堂房間號！");
        return;
      }
      if (!nameInput.trim()) {
        alert("請輸入您的課堂暱稱！");
        return;
      }
      onJoinRoom(roomIdInput.trim(), nameInput.trim());
    } else {
      onCreateRoom();
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-6 antialiased relative overflow-hidden">
      {/* Decorative ambient blobs in background */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

      {/* Main Container Card */}
      <div className="w-full max-w-md bg-slate-950/50 backdrop-blur-xl border border-slate-705/30 rounded-2xl shadow-2xl p-8 flex flex-col z-10">
        
        {/* Title Block */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center p-3.5 bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 rounded-2xl mb-4 shadow-inner">
            <BookOpen size={28} />
          </div>
          <h2 className="text-xl font-bold font-sans text-white tracking-wide uppercase">
            VIBE CLASSROOM <span className="text-indigo-400 italic">#HIGH_DENSITY</span>
          </h2>
          <p className="text-[10px] text-indigo-400 font-mono mt-1.5 uppercase tracking-widest">
            SESSION: SYNCHRONIZED • P2P VOICE ACTIVE
          </p>
        </div>

        {/* Action Error Alerts if any */}
        {errorMsg && (
          <div className="mb-6 p-4 bg-rose-500/15 border border-rose-500/30 rounded-xl text-rose-300 text-xs font-semibold leading-relaxed">
            ⚠️ 錯誤提示：{errorMsg}
          </div>
        )}

        {/* Tab Selection */}
        <div className="grid grid-cols-2 bg-slate-900 p-1 rounded-xl mb-6 border border-slate-750/30">
          <button
            type="button"
            onClick={() => setRole("student")}
            className={`py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
              role === "student"
                ? "bg-indigo-600 text-white shadow-xs"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <Users size={13} />
            <span>我是學生 (加入)</span>
          </button>
          <button
            type="button"
            onClick={() => setRole("teacher")}
            className={`py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
              role === "teacher"
                ? "bg-indigo-600 text-white shadow-xs"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <Sparkles size={13} />
            <span>我是老師 (創建)</span>
          </button>
        </div>

        {/* Submitting Form */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          {role === "student" ? (
            <>
              {/* Classroom Code */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                  <Key size={13} className="text-slate-500" />
                  課堂房間號 (6位數)
                </label>
                <input
                  type="text"
                  maxLength={6}
                  placeholder="例如：654321"
                  value={roomIdInput}
                  onChange={(e) => setRoomIdInput(e.target.value.replace(/\D/g, ""))}
                  className="w-full bg-slate-900 border border-slate-750/30 rounded-lg px-4 py-3 text-sm font-semibold text-white placeholder-slate-600 focus:outline-hidden focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  required
                />
              </div>

              {/* Student Nickname */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                  <User size={13} className="text-slate-500" />
                  個人課堂暱稱
                </label>
                <input
                  type="text"
                  maxLength={15}
                  placeholder="請輸入您的真實姓名或暱稱"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-755/30 rounded-lg px-4 py-3 text-sm font-semibold text-white placeholder-slate-600 focus:outline-hidden focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  required
                />
              </div>

              {/* Submit button for Student */}
              <button
                type="submit"
                disabled={isConnecting}
                className="w-full mt-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold py-3.5 rounded-lg shadow-lg shadow-indigo-500/10 transition-all flex items-center justify-center gap-2 cursor-pointer border border-indigo-500/20"
              >
                {isConnecting ? (
                  <>
                    <span className="w-4 h-4 border-2 border-slate-300 border-t-transparent rounded-full animate-spin" />
                    <span>正在連線並握手登入中...</span>
                  </>
                ) : (
                  <span>立刻登入上課教室</span>
                )}
              </button>
            </>
          ) : (
            <>
              {/* Explaining rules for Teacher */}
              <div className="bg-slate-900/60 p-4 border border-slate-800 rounded-lg text-xs text-slate-400 leading-relaxed flex flex-col gap-2 font-sans">
                <h4 className="font-bold text-white flex items-center gap-1.5">
                  👨‍🏫 出新講義與白板主控權
                </h4>
                <p className="text-[11px] text-slate-500 leading-normal">作為電子教室的主持老師，您將享有以下特權：</p>
                <ul className="list-disc list-inside space-y-1 pl-1 text-[11px] text-slate-400 leading-normal font-mono">
                  <li>自動生成專屬 6 數字短碼與網址 QR 條。</li>
                  <li>主控教材，支援圖片或 Markdown 生成。</li>
                  <li>一鍵靜音、批准學員解鎖。</li>
                  <li>廣播即時筆跡，學員唯讀跟隨。</li>
                </ul>
              </div>

              <button
                type="submit"
                disabled={isConnecting}
                className="w-full bg-indigo-650 hover:bg-indigo-600 disabled:opacity-50 text-white text-xs font-semibold py-3.5 rounded-lg shadow-lg shadow-indigo-500/10 transition-all flex items-center justify-center gap-2 cursor-pointer border border-indigo-550"
              >
                {isConnecting ? (
                  <>
                    <span className="w-4 h-4 border-2 border-slate-300 border-t-transparent rounded-full animate-spin" />
                    <span>正在開課中...</span>
                  </>
                ) : (
                  <span>建立新上課教室 • START CLASS</span>
                )}
              </button>
            </>
          )}
        </form>
      </div>

      {/* Aesthetic credit indicators */}
      <div className="mt-8 text-center text-slate-500 text-[10px] font-mono tracking-widest uppercase select-none flex items-center gap-2">
        <span>WebRTC 100% P2P AUDIO</span>
        <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
        <span>HIGH_PRECISION_CANVAS</span>
        <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
        <span>SECURE_ENCRYPTED</span>
      </div>
    </div>
  );
}
