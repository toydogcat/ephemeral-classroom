export interface Student {
  id: string;
  name: string;
  isMuted: boolean;
  isHandUp: boolean;
  canSpeak: boolean;
}

export interface ChatMessage {
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
    dataUrl: string; // encoded blob or base64
  };
}

export interface RoomState {
  roomId: string;
  hostSocketId: string;
  isAllMuted: boolean;
  whiteboardBackgrounds: string[]; // multi pages
  whiteboardPageNum: number;
  whiteboardPaths: any[]; // standard drawing paths for current page
  students: { [socketId: string]: Student };
  chatHistory: ChatMessage[];
  whitelistCount?: number;
}

export interface DrawAction {
  type: "draw" | "erase" | "clear";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  size: number;
}
