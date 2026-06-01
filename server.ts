import express from "express";
import path from "path";
import { createServer } from "http";
import { Server, Socket } from "socket.io";
import { createServer as createViteServer } from "vite";

interface Student {
  id: string; // socket.id
  name: string;
  isMuted: boolean;
  isHandUp: boolean;
  canSpeak: boolean;
}

interface Room {
  roomId: string;
  hostSocketId: string;
  isAllMuted: boolean;
  whiteboardBackgrounds: string[]; // list of background URLs/base64 (each represents a page)
  whiteboardPageNum: number;
  whiteboardPaths: { [pageNum: number]: any[] }; // drawing paths per page
  students: { [socketId: string]: Student };
  whitelist?: string[]; // student names or IDs whitelist
  chatHistory: Array<{
    id: string;
    senderId: string;
    senderName: string;
    role: "teacher" | "student";
    content: string;
    timestamp: number;
    type: "text" | "file";
    fileData?: {
      name: string;
      size: number;
      type: string;
      dataUrl: string; // Base64 or local blob URL
    };
  }>;
}

const rooms: { [roomId: string]: Room } = {};

async function startServer() {
  const app = express();
  const PORT = 3005;
  const httpServer = createServer(app);

  // Configure Socket.IO with dynamic payload sizing for file transfers and base64 sketches (max 20MB)
  const io = new Server(httpServer, {
    maxHttpBufferSize: 2e7,
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  // Track room by host or students to cleaning up on disconnect
  const socketToRoom: { [socketId: string]: { roomId: string; isHost: boolean; studentName?: string } } = {};

  io.on("connection", (socket: Socket) => {
    // 1. Create Room (Host action)
    socket.on("room:create", (callback) => {
      let roomId = "";
      // Search unique 6-digit classroom code
      for (let i = 0; i < 10; i++) {
        const potentialId = Math.floor(100000 + Math.random() * 900000).toString();
        if (!rooms[potentialId]) {
          roomId = potentialId;
          break;
        }
      }
      if (!roomId) {
        roomId = Math.floor(100000 + Math.random() * 900000).toString();
      }

      rooms[roomId] = {
        roomId,
        hostSocketId: socket.id,
        isAllMuted: false,
        whiteboardBackgrounds: [""], // default single page with transparent/empty background
        whiteboardPageNum: 0,
        whiteboardPaths: { 0: [] },
        students: {},
        chatHistory: [],
        whitelist: []
      };

      socket.join(roomId);
      socketToRoom[socket.id] = { roomId, isHost: true };

      if (callback) {
        callback({ success: true, roomId });
      }
    });

    // 2. Join Room (Student action)
    socket.on("room:join", ({ roomId, name }, callback) => {
      const room = rooms[roomId];
      if (!room) {
        if (callback) {
          callback({ success: false, error: "課堂房間號不存在！請再次確認您的連結或數字鍵。" });
        }
        return;
      }

      // Check if student nickname/学号 resides within active room whitelist
      if (room.whitelist && room.whitelist.length > 0) {
        const studentNameClean = name.trim().toLowerCase();
        const IsWhitelisted = room.whitelist.some(item => item.trim().toLowerCase() === studentNameClean);
        if (!IsWhitelisted) {
          if (callback) {
            callback({
              success: false,
              error: `【權限拒絕】此班級已啟用名冊白名單管制。您的暱稱/學號「${name}」不在准許名冊中，請確認學號，或請老師更新准許名單。`
            });
          }
          return;
        }
      }

      // Join socket.io channel
      socket.join(roomId);

      const student: Student = {
        id: socket.id,
        name,
        isMuted: room.isAllMuted,
        isHandUp: false,
        canSpeak: !room.isAllMuted // if classroom is muted, they need permission
      };

      room.students[socket.id] = student;
      socketToRoom[socket.id] = { roomId, isHost: false, studentName: name };

      // Broadcast student joins to the classroom
      socket.to(roomId).emit("student:joined", { student });

      // Return current full state to the newly joined student
      if (callback) {
        callback({
          success: true,
          room: {
            roomId: room.roomId,
            hostSocketId: room.hostSocketId,
            isAllMuted: room.isAllMuted,
            whiteboardBackgrounds: room.whiteboardBackgrounds,
            whiteboardPageNum: room.whiteboardPageNum,
            whiteboardPaths: room.whiteboardPaths[room.whiteboardPageNum] || [],
            students: room.students,
            chatHistory: room.chatHistory,
            whitelistCount: room.whitelist ? room.whitelist.length : 0
          }
        });
      }
    });

    // 3. Audio & Control Handshake
    // Force mute all
    socket.on("control:mute-all", ({ mute }) => {
      const socketInfo = socketToRoom[socket.id];
      if (!socketInfo || !socketInfo.isHost) return;

      const room = rooms[socketInfo.roomId];
      if (!room) return;

      room.isAllMuted = mute;
      // Mutate all students
      Object.keys(room.students).forEach((sid) => {
        room.students[sid].isMuted = mute;
        if (mute) {
          // revoke speaking unless hand remains approved separately
          room.students[sid].canSpeak = false;
        } else {
          room.students[sid].canSpeak = true;
        }
      });

      io.to(room.roomId).emit("control:mute-all", {
        isAllMuted: mute,
        students: room.students
      });
    });

    // Student hands up toggle
    socket.on("control:hand-up", ({ isHandUp }) => {
      const socketInfo = socketToRoom[socket.id];
      if (!socketInfo || socketInfo.isHost) return;

      const room = rooms[socketInfo.roomId];
      if (!room) return;

      const student = room.students[socket.id];
      if (student) {
        student.isHandUp = isHandUp;
        io.to(room.roomId).emit("control:handup-update", {
          studentId: socket.id,
          isHandUp,
          name: student.name
        });
      }
    });

    // Host allows or revokes sound permission
    socket.on("control:allow-speak", ({ studentSocketId, canSpeak }) => {
      const socketInfo = socketToRoom[socket.id];
      if (!socketInfo || !socketInfo.isHost) return;

      const room = rooms[socketInfo.roomId];
      if (!room) return;

      const student = room.students[studentSocketId];
      if (student) {
        student.canSpeak = canSpeak;
        student.isMuted = !canSpeak;
        if (canSpeak) {
          // Auto lower hand once speaker was approved
          student.isHandUp = false;
        }
        io.to(room.roomId).emit("control:speak-status", {
          studentSocketId,
          canSpeak,
          isMuted: !canSpeak,
          isHandUp: student.isHandUp
        });
      }
    });

    // Host uploads student name Whitelist
    socket.on("control:set-whitelist", ({ whitelist }) => {
      const socketInfo = socketToRoom[socket.id];
      if (!socketInfo || !socketInfo.isHost) return;

      const room = rooms[socketInfo.roomId];
      if (!room) return;

      // Ensure whitelist is an array of strings
      room.whitelist = Array.isArray(whitelist) ? whitelist : [];
      
      // Notify the teacher socket of successfully registered length
      io.to(socket.id).emit("control:whitelist-updated", { 
        whitelistCount: room.whitelist.length 
      });

      // Insert a clear, elegant system message into the chat room
      const systemMessage = {
        id: Math.random().toString().slice(2, 11),
        senderId: "system",
        senderName: "系統安全通知",
        role: "teacher" as const,
        content: `📈 點名與名單限制已更新：老師匯入了准許學號/暱稱名冊，共 ${room.whitelist.length} 位准許上線。`,
        timestamp: Date.now(),
        type: "text" as const
      };
      room.chatHistory.push(systemMessage);
      io.to(room.roomId).emit("chat:message", systemMessage);
    });

    // 4. Whiteboard Management
    // Background changes: files added, or new blank whiteboard pages instantiated
    socket.on("whiteboard:page-change", ({ pageNum, backgrounds }) => {
      const socketInfo = socketToRoom[socket.id];
      if (!socketInfo || !socketInfo.isHost) return;

      const room = rooms[socketInfo.roomId];
      if (!room) return;

      room.whiteboardPageNum = pageNum;
      if (backgrounds) {
        room.whiteboardBackgrounds = backgrounds;
      }

      // Initialize slide drawing buffer if not loaded yet
      if (!room.whiteboardPaths[pageNum]) {
        room.whiteboardPaths[pageNum] = [];
      }

      io.to(room.roomId).emit("whiteboard:page-change", {
        pageNum,
        backgrounds: room.whiteboardBackgrounds,
        paths: room.whiteboardPaths[pageNum]
      });
    });

    // Save pen events in active slide memory and broadcast coordinates
    socket.on("whiteboard:draw", (data) => {
      const socketInfo = socketToRoom[socket.id];
      if (!socketInfo || !socketInfo.isHost) return;

      const room = rooms[socketInfo.roomId];
      if (!room) return;

      const page = room.whiteboardPageNum;
      if (!room.whiteboardPaths[page]) {
        room.whiteboardPaths[page] = [];
      }
      room.whiteboardPaths[page].push(data);

      socket.to(room.roomId).emit("whiteboard:draw", data);
    });

    // Clear whiteboard page
    socket.on("whiteboard:clear", () => {
      const socketInfo = socketToRoom[socket.id];
      if (!socketInfo || !socketInfo.isHost) return;

      const room = rooms[socketInfo.roomId];
      if (!room) return;

      const page = room.whiteboardPageNum;
      room.whiteboardPaths[page] = [];

      io.to(room.roomId).emit("whiteboard:clear");
    });

    // 5. Chat & Document Upload Logs
    socket.on("chat:message", (msg) => {
      const socketInfo = socketToRoom[socket.id];
      if (!socketInfo) return;

      const room = rooms[socketInfo.roomId];
      if (!room) return;

      const chatMsg = {
        id: Math.random().toString().slice(2, 11),
        senderId: socket.id,
        senderName: socketInfo.isHost ? "老師" : (socketInfo.studentName || "學生"),
        role: (socketInfo.isHost ? "teacher" : "student") as "teacher" | "student",
        content: msg.content,
        timestamp: Date.now(),
        type: msg.type || "text",
        fileData: msg.fileData
      };

      room.chatHistory.push(chatMsg);
      // Keep chat history capped to recent 200 items to avoid swelling heap
      if (room.chatHistory.length > 200) {
        room.chatHistory.shift();
      }

      io.to(room.roomId).emit("chat:message", chatMsg);
    });

    // 6. WebRTC Core Mesh Signals routing
    socket.on("webrtc:signal", ({ targetSocketId, signal }) => {
      const socketInfo = socketToRoom[socket.id];
      if (!socketInfo) return;

      // Wrap sender ID and transmit downstream directly to specified target
      io.to(targetSocketId).emit("webrtc:signal", {
        senderSocketId: socket.id,
        signal
      });
    });

    // 7. Disconnection handlers
    socket.on("disconnect", () => {
      const socketInfo = socketToRoom[socket.id];
      if (!socketInfo) return;

      const { roomId, isHost, studentName } = socketInfo;
      const room = rooms[roomId];

      if (room) {
        if (isHost) {
          // If host exits, broadcast termination warning to clients and clean up memory
          socket.to(roomId).emit("room:destroyed", {
            message: "課堂已被老師關閉，臨時對話已結束。"
          });
          delete rooms[roomId];
        } else {
          // If normal student leaves, remove them clean and send event to roommate
          delete room.students[socket.id];
          socket.to(roomId).emit("student:left", {
            studentId: socket.id,
            name: studentName,
            studentsList: room.students
          });
        }
      }

      delete socketToRoom[socket.id];
    });
  });

  // Serve API or health index
  app.get("/api/health", (req, res) => {
    res.json({ status: "healthy", connections: io.engine.clientsCount });
  });

  // Incorporate Vite or client dist build
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Classroom signaling server active at: http://localhost:${PORT}`);
  });
}

startServer().catch((error) => {
  console.error("Starting signaling server failed:", error);
});
