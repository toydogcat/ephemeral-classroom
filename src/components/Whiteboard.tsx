import React, { useRef, useEffect, useState } from "react";
import { 
  Pencil, 
  Eraser, 
  Trash2, 
  ChevronLeft, 
  ChevronRight, 
  Upload, 
  Code,
  Sparkles,
  FileText,
  Hand,
  ZoomIn,
  ZoomOut,
  Maximize
} from "lucide-react";
import html2canvas from "html2canvas";
import { marked } from "marked";

interface WhiteboardProps {
  isHost: boolean;
  backgrounds: string[];
  pageNum: number;
  paths: any[];
  onDraw: (data: any) => void;
  onClear: () => void;
  onPageChange: (pageNum: number, backgrounds?: string[]) => void;
}

export default function Whiteboard({
  isHost,
  backgrounds,
  pageNum,
  paths,
  onDraw,
  onClear,
  onPageChange,
}: WhiteboardProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // States
  const [color, setColor] = useState<string>("#ef4444"); // default red pencil
  const [lineWidth, setLineWidth] = useState<number>(5);
  const [isDrawing, setIsDrawing] = useState<boolean>(false);
  const [tool, setTool] = useState<"pencil" | "eraser" | "hand">("pencil");

  // Zoom & Pan states
  const [zoom, setZoom] = useState<number>(1.0);
  const [panOffset, setPanOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState<boolean>(false);
  const [panStart, setPanStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Markdown importer states
  const [showMarkdownModal, setShowMarkdownModal] = useState<boolean>(false);
  const [markdownInput, setMarkdownInput] = useState<string>(
    `# 💡 今日課堂主題：大氣壓力\n\n- **1. 思考問題**：為什麼吸管可以吸起飲料？\n- **2. 重點公式**：$P = F / A$\n- **3. 小組討論**：在玉山頂煮水幾度會沸騰？`
  );

  const prevPos = useRef<{ x: number; y: number } | null>(null);

  // Logical grid coordinates (independent of physical dimensions to guarantee 100% student mirroring)
  const LOGICAL_WIDTH = 1200;
  const LOGICAL_HEIGHT = 900;

  // Initialize and clear/redraw paths when slide, backgrounds, or server-stored drawing state shifts
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Reset and clear transparent drawing board
    ctx.clearRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);

    // Apply all historical drawing operations on this slide
    if (paths && paths.length > 0) {
      paths.forEach((p) => {
        ctx.beginPath();
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.lineWidth = p.size;

        if (p.type === "erase") {
          ctx.globalCompositeOperation = "destination-out";
          ctx.strokeStyle = "rgba(0,0,0,1)";
        } else {
          ctx.globalCompositeOperation = "source-over";
          ctx.strokeStyle = p.color;
        }

        ctx.moveTo(p.x1, p.y1);
        ctx.lineTo(p.x2, p.y2);
        ctx.stroke();
        ctx.closePath();
      });

      // Restore composite operation default
      ctx.globalCompositeOperation = "source-over";
    }
  }, [paths, pageNum, backgrounds]);

  // Handle local drawing operations
  const getCoordinates = (e: React.MouseEvent | React.TouchEvent): { x: number; y: number } | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    const rect = canvas.getBoundingClientRect();
    let clientX = 0;
    let clientY = 0;

    if ("touches" in e) {
      if (e.touches.length === 0) return null;
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    // Map screen cursor inside logical canvas size (1200 x 900 Grid)
    const x = ((clientX - rect.left) / rect.width) * LOGICAL_WIDTH;
    const y = ((clientY - rect.top) / rect.height) * LOGICAL_HEIGHT;

    return { x, y };
  };

  const startDraw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    
    let clientX = 0;
    let clientY = 0;
    if ("touches" in e) {
      if (e.touches.length === 0) return;
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    if (tool === "hand") {
      setIsPanning(true);
      setPanStart({
        x: clientX - panOffset.x,
        y: clientY - panOffset.y,
      });
      return;
    }

    if (!isHost) return; // students are read-only views
    const pos = getCoordinates(e);
    if (!pos) return;

    setIsDrawing(true);
    prevPos.current = pos;
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();

    let clientX = 0;
    let clientY = 0;
    if ("touches" in e) {
      if (e.touches.length === 0) return;
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    if (tool === "hand") {
      if (!isPanning) return;
      const dx = clientX - panStart.x;
      const dy = clientY - panStart.y;
      setPanOffset({ x: dx, y: dy });
      return;
    }

    if (!isHost || !isDrawing || !prevPos.current) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const currentPos = getCoordinates(e);
    if (!currentPos) return;

    // Draw on local canvas directly
    ctx.beginPath();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = lineWidth;

    if (tool === "eraser") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.strokeStyle = "rgba(0,0,0,1)";
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = color;
    }

    ctx.moveTo(prevPos.current.x, prevPos.current.y);
    ctx.lineTo(currentPos.x, currentPos.y);
    ctx.stroke();
    ctx.closePath();
    ctx.globalCompositeOperation = "source-over"; // Reset composite state

    // Emit event coordinate delta back to signaling room for socket broadcasting
    onDraw({
      x1: prevPos.current.x,
      y1: prevPos.current.y,
      x2: currentPos.x,
      y2: currentPos.y,
      color: tool === "eraser" ? "transparent" : color,
      size: lineWidth,
      type: tool === "eraser" ? "erase" : "draw",
    });

    prevPos.current = currentPos;
  };

  const stopDraw = () => {
    setIsDrawing(false);
    setIsPanning(false);
    prevPos.current = null;
  };

  // Add Wheel zoom listener with non-passive options to prevent default background scrolls
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const zoomFactor = 1.08;
      setZoom((prevZoom) => {
        let nextZoom = prevZoom;
        if (e.deltaY < 0) {
          nextZoom = Math.min(prevZoom * zoomFactor, 5.0);
        } else {
          nextZoom = Math.max(prevZoom / zoomFactor, 0.5);
        }
        return nextZoom;
      });
    };

    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      container.removeEventListener("wheel", handleWheel);
    };
  }, []);

  // Load PDF.js helper library from CDN
  const loadPdfScript = (): Promise<any> => {
    return new Promise((resolve, reject) => {
      if ((window as any).pdfjsLib) {
        resolve((window as any).pdfjsLib);
        return;
      }
      const script = document.createElement("script");
      script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
      script.onload = () => {
        const pdfjsLib = (window as any).pdfjsLib;
        pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
        resolve(pdfjsLib);
      };
      script.onerror = (err) => reject(err);
      document.head.appendChild(script);
    });
  };

  // Convert PDF file's pages to multiple PNG data URLs
  const renderPdfPages = async (file: File): Promise<string[]> => {
    try {
      const pdfjsLib = await loadPdfScript();
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const numPages = pdf.numPages;
      const urls: string[] = [];

      for (let i = 1; i <= numPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 2.0 }); // High resolution suitable for rendering text
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");
        
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        
        if (context) {
          await page.render({
            canvasContext: context,
            viewport: viewport,
          }).promise;
          const dataUrl = canvas.toDataURL("image/png");
          urls.push(dataUrl);
        }
      }
      return urls;
    } catch (error) {
      console.error("Failed to render PDF: ", error);
      alert("解析或渲染 PDF 檔案失敗，請檢查該 PDF 是否有加密或損壞！");
      return [];
    }
  };

  // Turn teacher's uploaded photos or PDF documents into slide pages
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!isHost || !e.target.files) return;
    const files = Array.from(e.target.files) as File[];

    const isProcessingPdf = files.some(f => f.name.toLowerCase().endsWith(".pdf"));
    let loadingToast: HTMLDivElement | null = null;
    
    if (isProcessingPdf) {
      // Create a small loading notification for processing PDFs
      loadingToast = document.createElement("div");
      loadingToast.style.position = "fixed";
      loadingToast.style.bottom = "20px";
      loadingToast.style.right = "20px";
      loadingToast.style.backgroundColor = "#4f46e5";
      loadingToast.style.color = "#ffffff";
      loadingToast.style.padding = "12px 20px";
      loadingToast.style.borderRadius = "8px";
      loadingToast.style.zIndex = "9999";
      loadingToast.style.fontFamily = "monospace";
      loadingToast.style.fontSize = "12px";
      loadingToast.style.boxShadow = "0 10px 15px -3px rgba(0, 0, 0, 0.3)";
      loadingToast.textContent = "⏱️ PROCESS_PDF: 正在解析並渲染 PDF 每一頁為白板教材...";
      document.body.appendChild(loadingToast);
    }

    try {
      const results: string[] = [];

      for (const file of files) {
        if (file.name.toLowerCase().endsWith(".pdf")) {
          const pdfPages = await renderPdfPages(file);
          results.push(...pdfPages);
        } else {
          // Normal image file
          const imgUrl = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = (event) => {
              resolve(event.target?.result as string);
            };
            reader.readAsDataURL(file);
          });
          results.push(imgUrl);
        }
      }

      if (results.length > 0) {
        // Append loaded backgrounds or initialize as new slide deck
        const nextBackgrounds = [...backgrounds];
        let startIdx = nextBackgrounds.length;

        // Replace initial blank first page if it fits without assets
        if (nextBackgrounds.length === 1 && nextBackgrounds[0] === "") {
          nextBackgrounds[0] = results[0];
          results.slice(1).forEach((res) => nextBackgrounds.push(res));
          startIdx = 0;
        } else {
          results.forEach((res) => nextBackgrounds.push(res));
        }

        onPageChange(startIdx, nextBackgrounds);
      }
    } catch (err) {
      console.error("File processing error: ", err);
    } finally {
      if (loadingToast && loadingToast.parentNode) {
        loadingToast.parentNode.removeChild(loadingToast);
      }
      // Reset target value
      e.target.value = "";
    }
  };

  // Multi-page sliders navigation
  const prevPage = () => {
    if (pageNum > 0) {
      onPageChange(pageNum - 1);
    }
  };

  const nextPage = () => {
    if (pageNum < backgrounds.length - 1) {
      onPageChange(pageNum + 1);
    } else if (isHost) {
      // Host can create a blank next slide automatically
      const nextBg = [...backgrounds, ""];
      onPageChange(pageNum + 1, nextBg);
    }
  };

  // Convert teacher input Markdown into high-fidelity image snapshots
  const convertMarkdownToWhiteboardBg = async () => {
    setShowMarkdownModal(false);
    
    // Create hidden document renderer DOM
    const tempContainer = document.createElement("div");
    tempContainer.style.position = "absolute";
    tempContainer.style.top = "-9999px";
    tempContainer.style.left = "-9999px";
    tempContainer.style.width = "800px";
    tempContainer.style.minHeight = "600px";
    tempContainer.style.padding = "40px";
    tempContainer.style.backgroundColor = "#ffffff";
    tempContainer.style.color = "#1f2937";
    tempContainer.style.fontSize = "18px";
    tempContainer.style.lineHeight = "1.6";
    tempContainer.style.fontFamily = "Inter, sans-serif";

    // Set styling and compile HTML utilizing marked
    const renderedHtml = await marked.parse(markdownInput);
    tempContainer.innerHTML = `
      <div style="border-left: 6px solid #ef4444; padding-left: 15px; margin-bottom: 25px;">
        <span style="font-size: 13px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.1em; color: #ef4444;">數位教材電子化講義</span>
      </div>
      <article style="
        font-family: inherit;
        color: inherit;
      ">
        ${renderedHtml}
      </article>
      <div style="margin-top: 50px; border-top: 1px solid #e5e7eb; padding-top: 15px; font-size: 12px; color: #9ca3af; display: flex; justify-content: space-between;">
        <span>臨時課堂講義板</span>
        <span>智慧轉碼引擎生成</span>
      </div>
    `;

    document.body.appendChild(tempContainer);

    try {
      // Take snapshot using html2canvas
      const snapshotCanvas = await html2canvas(tempContainer, {
        backgroundColor: "#ffffff",
        logging: false,
        useCORS: true,
        scale: 2 // double resolution for retina clarity
      });

      const base64Img = snapshotCanvas.toDataURL("image/png");

      const nextBackgrounds = [...backgrounds];
      if (nextBackgrounds.length === 1 && nextBackgrounds[0] === "") {
        nextBackgrounds[0] = base64Img;
        onPageChange(0, nextBackgrounds);
      } else {
        const nextIndex = pageNum + 1;
        // Insert directly after currently matching index page
        nextBackgrounds.splice(nextIndex, 0, base64Img);
        onPageChange(nextIndex, nextBackgrounds);
      }
    } catch (err) {
      console.error("Markdown conversion failed:", err);
    } finally {
      document.body.removeChild(tempContainer);
    }
  };

  // Helper colors
  const palette = [
    { name: "鮮紅", code: "#ef4444" },
    { name: "亮藍", code: "#3b82f6" },
    { name: "深黑", code: "#111827" },
    { name: "嫩綠", code: "#10b981" },
    { name: "醒目黃", code: "#eab308" }
  ];

  // Combined snapshot download (Background + Canvas paths)
  const downloadSnapshot = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Create a temporary canvas to merge background and drawings
    const mergeCanvas = document.createElement("canvas");
    mergeCanvas.width = LOGICAL_WIDTH;
    mergeCanvas.height = LOGICAL_HEIGHT;
    const mctx = mergeCanvas.getContext("2d");
    if (!mctx) return;

    const proceed = () => {
      // 2. Draw the drawing canvas on top
      mctx.drawImage(canvas, 0, 0);

      // 3. Trigger download
      const link = document.createElement("a");
      const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
      link.download = `VibeClassroom_Snapshot_${timestamp}.png`;
      link.href = mergeCanvas.toDataURL("image/png");
      link.click();
    };

    // 1. Draw background first if exists
    if (currentBg) {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        mctx.fillStyle = "#ffffff";
        mctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
        mctx.drawImage(img, 0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
        proceed();
      };
      img.src = currentBg;
    } else {
      mctx.fillStyle = "#ffffff";
      mctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
      proceed();
    }
  };

  return (
    <div className="flex flex-col gap-4 w-full h-full text-slate-100">
      {/* 1. Whiteboard canvas and Overlay Background inside aspect box */}
      <div 
        ref={containerRef}
        className="relative w-full aspect-[4/3] bg-slate-950 border border-slate-800/80 rounded-2xl shadow-lg overflow-hidden select-none"
      >
        {/* Transforming stage wrapping backgrounds and drawing canvas */}
        <div
          className="w-full h-full relative"
          style={{
            transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoom})`,
            transformOrigin: "center center",
            transition: isPanning ? "none" : "transform 0.1s ease-out"
          }}
        >
          {/* Transparent grid patterns when whiteboard background matches empty state */}
          {!currentBg && (
            <div className="absolute inset-0 bg-grid-slate-800 pointer-events-none opacity-40" 
                 style={{ backgroundImage: "radial-gradient(#334155 1px, transparent 1px)", backgroundSize: "20px 20px" }}
            />
          )}

          {/* Dynamic Static lecture photo underneath standard canvas */}
          {currentBg && (
            <img 
              src={currentBg} 
              alt={`Page ${pageNum + 1} Lecture Background`}
              referrerPolicy="no-referrer"
              className="absolute inset-0 w-full h-full object-contain pointer-events-none bg-slate-900 z-0"
            />
          )}

          {/* Overlaid Drawing canvas */}
          <canvas
            id="classroom-interactive-canvas"
            ref={canvasRef}
            width={LOGICAL_WIDTH}
            height={LOGICAL_HEIGHT}
            onMouseDown={startDraw}
            onMouseMove={draw}
            onMouseUp={stopDraw}
            onMouseLeave={stopDraw}
            onTouchStart={startDraw}
            onTouchMove={draw}
            onTouchEnd={stopDraw}
            className={`absolute inset-0 w-full h-full z-10 touch-none ${
              tool === "hand"
                ? isPanning ? "cursor-grabbing" : "cursor-grab"
                : isHost 
                  ? tool === "eraser" ? "cursor-cell" : "cursor-crosshair" 
                  : "cursor-default"
            }`}
          />
        </div>

        {/* Floating Page Number Badge */}
        <div className="absolute top-4 left-4 inline-flex items-center gap-1.5 px-3 py-1 bg-slate-900/90 backdrop-blur-md rounded-lg text-xs font-semibold text-white tracking-wider pointer-events-none z-10 antialiased shadow-sm border border-slate-850">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          <span>白板講義： 頁次 {pageNum + 1} / {backgrounds.length}</span>
        </div>

        {/* Floating Zoom & Pan overlay controller */}
        <div className="absolute bottom-4 right-4 z-20 flex items-center gap-1.5 p-1 bg-slate-900/90 backdrop-blur border border-slate-800 rounded shadow-2xl shrink-0">
          <button
            onClick={() => setTool(tool === "hand" ? "pencil" : "hand")}
            className={`p-2 rounded transition-all cursor-pointer flex items-center justify-center ${
              tool === "hand" 
                ? "bg-indigo-600 text-white" 
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800"
            }`}
            title="平移模式 (拖曳或雙指平移)"
          >
            <Hand size={13} className={tool === "hand" ? "animate-pulse" : ""} />
          </button>

          <div className="h-4 w-px bg-slate-800" />

          {/* Zoom Out */}
          <button
            onClick={() => setZoom(prev => Math.max(prev / 1.15, 0.5))}
            className="p-2 text-slate-300 hover:bg-slate-850 rounded transition-all cursor-pointer flex items-center justify-center"
            title="縮小"
          >
            <ZoomOut size={13} />
          </button>

          {/* Percentage Indicator */}
          <span className="text-[10px] font-mono font-bold text-slate-400 px-1 min-w-[36px] text-center">
            {Math.round(zoom * 100)}%
          </span>

          <div className="h-4 w-px bg-slate-800" />

          {/* Download Snapshot Button */}
          <button
            onClick={downloadSnapshot}
            className="p-2 text-emerald-400 hover:bg-slate-800 rounded transition-all cursor-pointer flex items-center justify-center"
            title="下載當前講義截圖"
          >
            <Sparkles size={13} className="mr-1" />
            <span className="text-[9px] font-bold">SNAPSHOT</span>
          </button>

          <div className="h-4 w-px bg-slate-800" />

          {/* Zoom In */}
          <button
            onClick={() => setZoom(prev => Math.min(prev * 1.15, 5.0))}
            className="p-2 text-slate-300 hover:bg-slate-850 rounded transition-all cursor-pointer flex items-center justify-center"
            title="放大"
          >
            <ZoomIn size={13} />
          </button>

          {/* Fit Screen */}
          <button
            onClick={() => {
              setZoom(1.0);
              setPanOffset({ x: 0, y: 0 });
            }}
            className="p-2 text-[#a5b4fc] hover:bg-slate-800 rounded transition-all cursor-pointer flex items-center justify-center"
            title="還原縮放"
          >
            <Maximize size={12} />
          </button>
        </div>

        {/* Read-Only Banner for students */}
        {!isHost && (
          <div className="absolute bottom-4 left-4 text-center px-4 py-2 bg-slate-950/95 backdrop-blur border border-slate-800 rounded text-[11px] font-mono tracking-wider text-slate-400 pointer-events-none z-10 shadow-lg flex items-center justify-center gap-2 max-w-[calc(100%-250px)] truncate">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span>學生模式：可自由滾輪縮放與滑動瀏覽</span>
          </div>
        )}
      </div>

      {/* 2. Whiteboard toolbar control bar (Exclusive for host teacher) */}
      <div className="w-full flex flex-wrap gap-3 items-center justify-between p-3.5 bg-slate-950/40 rounded-xl border border-slate-800/80 shadow-xs">
        {/* Slides Navigation */}
        <div className="flex items-center gap-1">
          <button
            onClick={prevPage}
            disabled={pageNum === 0}
            className="p-2 bg-slate-900 hover:bg-slate-850 disabled:opacity-50 border border-slate-800 text-slate-300 rounded transition-all disabled:pointer-events-none flex items-center justify-center cursor-pointer"
            title="前一頁"
          >
            <ChevronLeft size={14} />
          </button>
          
          <span className="text-[10px] font-bold text-slate-400 px-3 font-mono">
            PAGE {pageNum + 1} / {backgrounds.length}
          </span>

          <button
            onClick={nextPage}
            disabled={!isHost && pageNum === backgrounds.length - 1}
            className="p-2 bg-slate-900 hover:bg-slate-850 border border-slate-800 text-slate-300 rounded transition-all flex items-center justify-center cursor-pointer"
            title={pageNum === backgrounds.length - 1 ? "建立空畫布" : "下一頁"}
          >
            <ChevronRight size={14} />
          </button>
        </div>

        {/* Draw tool settings (visible to teacher) */}
        {isHost ? (
          <div className="flex flex-wrap gap-4 items-center">
            {/* Drawing tool selectors */}
            <div className="flex items-center bg-slate-900 p-0.5 rounded border border-slate-800">
              <button
                onClick={() => setTool("pencil")}
                className={`px-3 py-1 flex items-center gap-1 text-[10px] uppercase font-mono font-bold rounded transition-all cursor-pointer ${
                  tool === "pencil"
                    ? "bg-indigo-650 text-white shadow-xs"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <Pencil size={11} />
                <span>Pencil</span>
              </button>
              <button
                onClick={() => setTool("eraser")}
                className={`px-3 py-1 flex items-center gap-1 text-[10px] uppercase font-mono font-bold rounded transition-all cursor-pointer ${
                  tool === "eraser"
                    ? "bg-indigo-650 text-white shadow-xs"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <Eraser size={11} />
                <span>Eraser</span>
              </button>
            </div>

            {/* Render colors selection palette */}
            {tool === "pencil" && (
              <div className="flex items-center gap-1.5 p-1 bg-slate-900 rounded border border-slate-800">
                {palette.map((p) => (
                  <button
                    key={p.code}
                    onClick={() => setColor(p.code)}
                    className="w-4 h-4 rounded-full flex items-center justify-center transition-transform hover:scale-115 cursor-pointer relative"
                    style={{ backgroundColor: p.code }}
                    title={p.name}
                  >
                    {color === p.code && (
                      <span className="w-1.5 h-1.5 rounded-full bg-slate-950 block" />
                    )}
                  </button>
                ))}
              </div>
            )}

            {/* Stroke size selector */}
            <div className="flex items-center gap-2 px-2.5 py-1 bg-slate-900 rounded border border-slate-800">
              <span className="text-[9px] font-mono font-bold text-slate-500 uppercase tracking-widest shrink-0">
                SIZE
              </span>
              <input
                type="range"
                min="2"
                max="30"
                value={lineWidth}
                onChange={(e) => setLineWidth(parseInt(e.target.value))}
                className="w-16 accent-indigo-500 h-1 bg-slate-850 rounded-lg cursor-pointer"
              />
              <span className="text-[10px] font-bold text-slate-300 font-mono w-7 text-right">
                {lineWidth}px
              </span>
            </div>

            {/* Document helpers and clean slate */}
            <div className="flex items-center gap-1.5">
              {/* Image Input Trigger */}
              <label 
                className="p-2 cursor-pointer bg-slate-900 hover:bg-slate-850 border border-slate-805 text-slate-300 rounded transition-all flex items-center justify-center gap-1 text-[10px] uppercase font-mono font-bold"
                title="導入外部教材圖片、多頁 PDF 簡報，支援多選與分頁追加"
              >
                <Upload size={12} className="text-indigo-400" />
                <span>Upload BG</span>
                <input
                  type="file"
                  multiple
                  accept="image/*,.pdf"
                  onChange={handleImageUpload}
                  className="hidden"
                />
              </label>

              {/* Markdown Slides script editor */}
              <button
                onClick={() => setShowMarkdownModal(true)}
                className="p-2 bg-slate-900 hover:bg-slate-850 border border-slate-800 text-slate-300 rounded transition-all flex items-center justify-center gap-1 text-[10px] uppercase font-mono font-bold cursor-pointer"
                title="Markdown 轉高畫質背景教材頁"
              >
                <Code size={12} className="text-indigo-400" />
                <span>Load MD</span>
              </button>

              {/* Clear path sketches */}
              <button
                onClick={onClear}
                className="p-2 bg-rose-950/10 hover:bg-rose-955/25 border border-rose-900/40 text-rose-300 rounded transition-all flex items-center justify-center gap-1 text-[10px] uppercase font-mono font-bold cursor-pointer"
                title="清除當前頁的所有筆跡"
              >
                <Trash2 size={12} className="text-rose-455" />
                <span>Clear</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="text-[11px] text-slate-500 font-mono uppercase italic tracking-wider max-md:w-full max-md:text-center">
            💡 TIP: CLICK "ASK_HAND" ON THE RIGHT CENTER SIDEBAR TO ASK FOR VOICE PRIVILEGES.
          </div>
        )}
      </div>

      {/* 3. Markdown Importer Modal overlay */}
      {showMarkdownModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-slate-950 border border-slate-800 w-full max-w-lg rounded-2xl shadow-2xl flex flex-col p-6 animate-in fade-in zoom-in-95 duration-205">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-2 flex items-center gap-2">
              <Sparkles className="text-indigo-400" size={16} />
              <span>MARKDOWN教材投影片渲染生成</span>
            </h3>
            <p className="text-[11px] text-slate-400 mb-4 leading-relaxed font-sans">
              輸入以下 Markdown 文字，系統會於前端高畫質排版排版、支援文字縮放，並截圖轉化為一張全新的教材投影片底圖：
            </p>

            <textarea
              value={markdownInput}
              onChange={(e) => setMarkdownInput(e.target.value)}
              className="w-full h-48 bg-slate-900 border border-slate-800 rounded-lg p-3 text-sm font-mono text-slate-200 focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 focus:outline-hidden"
              placeholder="# Slide title..."
            />

            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => setShowMarkdownModal(false)}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-850 border border-slate-805 text-slate-400 rounded text-xs font-semibold cursor-pointer"
              >
                取消 Cancel
              </button>
              <button
                onClick={convertMarkdownToWhiteboardBg}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-xs font-semibold flex items-center gap-1 cursor-pointer border border-indigo-500/25"
              >
                <Sparkles size={12} />
                <span>渲染教材頁 Generate</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
