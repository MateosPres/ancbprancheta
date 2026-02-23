import React, { useState, useEffect, useRef } from 'react';
import { Stage, Layer, Image as KonvaImage, Group, Circle, Text, Rect, Line } from 'react-konva';
import { UserPlus, X, Trash2, RotateCcw, Pencil, MousePointer2, Undo, Eraser, Save, FolderOpen, Plus, Play, Pause, Copy } from 'lucide-react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from './services/firebase';
import Konva from 'konva';

// ============================================================================
// TIPOS & INTERFACES
// ============================================================================

interface Player {
  id: string;
  nome: string;
  foto?: string | null;
  posicao?: string;
}

interface Token {
  id: string;
  type: 'ancb' | 'rival';
  x: number;
  y: number;
  nome?: string;
  foto?: string | null;
  numero?: number;
}

interface DrawnLine {
  tool: string;
  color: string;
  points: number[];
}

interface Frame {
    tokens: Token[];
    lines: DrawnLine[];
    note?: string;
}

interface SavedPlay {
    id: string;
    name: string;
    courtType: 'half' | 'full';
    frames: Frame[];
    createdAt: number;
}

interface Assets {
  lines: HTMLImageElement | null;
  logo: HTMLImageElement | null;
}

const ASSETS_URLS = {
  courtHalf: 'https://i.imgur.com/SIdCxjw.png',
  courtFull: 'https://i.imgur.com/cw3dO3o.png',
  logo: 'https://i.imgur.com/sfO9ILj.png',
  defaultAvatar: 'https://ui-avatars.com/api/?background=0D8ABC&color=fff&rounded=true&bold=true&name='
};

const PEN_COLORS = ['#ffffff', '#F27405', '#ef4444', '#facc15', '#000000'];

// ============================================================================
// COMPONENTE TOKEN
// ============================================================================

interface PlayerTokenProps {
  token: Token;
  onDragEnd: (id: string, x: number, y: number) => void;
  onSelect: (id: string) => void;
  isSelected: boolean;
  isLocked: boolean;
}

const PlayerToken: React.FC<PlayerTokenProps> = ({ token, onDragEnd, onSelect, isSelected, isLocked }) => {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading');

  useEffect(() => {
    if (token.type === 'rival') {
        setStatus('error');
        return;
    }
    const img = new window.Image();
    const src = token.foto || `${ASSETS_URLS.defaultAvatar}${token.nome}`;
    const isBase64 = src.startsWith('data:');

    if (!isBase64) {
        img.crossOrigin = 'Anonymous'; 
        const separator = src.includes('?') ? '&' : '?';
        img.src = `${src}${separator}t=${new Date().getTime()}`;
    } else {
        img.src = src;
    }

    img.onload = () => {
        if (img.width > 0 && img.height > 0) {
            setImage(img);
            setStatus('loaded');
        } else {
            setStatus('error');
        }
    };
    img.onerror = () => setStatus('error');
  }, [token.foto, token.nome]);

  const radius = 22;
  const diameter = radius * 2;
  const isOpponent = token.type === 'rival';
  const mainColor = isOpponent ? '#ef4444' : '#062553';
  const strokeColor = isOpponent ? '#991b1b' : '#041b3d';
  const showText = isOpponent || status !== 'loaded';

  return (
    <Group
      draggable={!isLocked}
      x={token.x}
      y={token.y}
      onDragEnd={(e) => onDragEnd(token.id, e.target.x(), e.target.y())}
      onClick={(e) => { e.cancelBubble = true; onSelect(token.id); }}
      onTap={(e) => { e.cancelBubble = true; onSelect(token.id); }}
    >
      <Circle radius={radius} fill="black" opacity={0.3} offsetX={-2} offsetY={-2} />
      {showText && <Circle radius={radius} fill={mainColor} />}
      {!showText && image && (
         <KonvaImage image={image} width={diameter} height={diameter} x={-radius} y={-radius} cornerRadius={radius} />
      )}
      <Circle radius={radius} stroke={isSelected ? '#F27405' : strokeColor} strokeWidth={isSelected ? 4 : 2} fillEnabled={false} />
      {showText && (
        <Text text={isOpponent ? token.numero?.toString() : token.nome?.charAt(0).toUpperCase()} fontSize={20} fontStyle="bold" fill="white" align="center" verticalAlign="middle" offsetX={6} offsetY={8} listening={false} />
      )}
      {!isOpponent && token.nome && (
        <Text text={token.nome.split(' ')[0]} y={radius + 6} fontSize={11} fill="white" align="center" width={100} offsetX={50} shadowColor="black" shadowBlur={3} listening={false} />
      )}
    </Group>
  );
};

// ============================================================================
// APP PRINCIPAL
// ============================================================================

const App = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Layout e Assets
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [courtType, setCourtType] = useState<'half' | 'full'>('half');
  const [assets, setAssets] = useState<Assets>({ lines: null, logo: null });
  
  // Dados Básicos
  const [dbPlayers, setDbPlayers] = useState<Player[]>([]);
  const [showMenu, setShowMenu] = useState(false);
  const [selectedTokenId, setSelectedTokenId] = useState<string | null>(null);

  // --- SISTEMA DE FRAMES (TIMELINE) ---
  const [frames, setFrames] = useState<Frame[]>([{ tokens: [], lines: [] }]);
  const [currentFrameIndex, setCurrentFrameIndex] = useState(0);
  
  // Estados visuais imediatos
  const [tokens, setTokens] = useState<Token[]>([]);
  const [lines, setLines] = useState<DrawnLine[]>([]);

  // Ferramentas & Animação
  const [tool, setTool] = useState<'cursor' | 'pen'>('cursor');
  const [lineColor, setLineColor] = useState('#ffffff');
  const [isDrawing, setIsDrawing] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);

  // Salvar/Carregar
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showLoadModal, setShowLoadModal] = useState(false);
  const [playName, setPlayName] = useState('');
  const [savedPlays, setSavedPlays] = useState<SavedPlay[]>([]);

  // 1. Inicialização
  useEffect(() => {
    const fetchPlayers = async () => {
      try {
        const querySnapshot = await getDocs(collection(db, "jogadores"));
        const playersList = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Player[];
        setDbPlayers(playersList.sort((a, b) => a.nome.localeCompare(b.nome)));
      } catch (error) { console.error("Erro ao buscar jogadores:", error); }
    };
    fetchPlayers();
    loadSavedPlays();
  }, []);

  useEffect(() => {
    const loadAssets = () => {
        const imgLines = new window.Image();
        imgLines.crossOrigin = 'Anonymous';
        imgLines.src = courtType === 'half' ? ASSETS_URLS.courtHalf : ASSETS_URLS.courtFull;
        const imgLogo = new window.Image();
        imgLogo.crossOrigin = 'Anonymous';
        imgLogo.src = ASSETS_URLS.logo;
        Promise.all([new Promise(r => imgLines.onload = r), new Promise(r => imgLogo.onload = r)]).then(() => {
          setAssets({ lines: imgLines, logo: imgLogo });
        });
    };
    loadAssets();
  }, [courtType]);

  // 2. Responsividade e Inicialização de Rivais
  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        setDimensions({ width: containerRef.current.offsetWidth, height: containerRef.current.offsetHeight });
        // Se for o primeiro load, cria os rivais
        if (tokens.length === 0 && frames[0].tokens.length === 0) {
            const rivals: Token[] = [1, 2, 3, 4, 5].map(num => ({
                id: `rival-${num}`, type: 'rival', numero: num, x: 40, y: 100 + (num * 60)
            }));
            updateCurrentFrame(rivals, []);
        }
      }
    };
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  // --- LÓGICA DE ANIMAÇÃO (PLAY) ---
  useEffect(() => {
    let interval: any;
    if (isPlaying) {
        interval = setInterval(() => {
            setCurrentFrameIndex(prev => {
                const next = prev + 1;
                if (next >= frames.length) {
                    setIsPlaying(false); // Para no final
                    return prev;
                }
                // Carrega o próximo frame
                setTokens(frames[next].tokens);
                setLines(frames[next].lines);
                return next;
            });
        }, 800); // 800ms por frame
    }
    return () => clearInterval(interval);
  }, [isPlaying, frames]);

  // --- LÓGICA CORE DOS FRAMES ---

  const updateCurrentFrame = (newTokens: Token[], newLines: DrawnLine[]) => {
    setTokens(newTokens);
    setLines(newLines);
    setFrames(prev => {
        const newFrames = [...prev];
        newFrames[currentFrameIndex] = { tokens: newTokens, lines: newLines };
        return newFrames;
    });
  };

  const changeFrame = (index: number) => {
    if (index >= 0 && index < frames.length) {
        setCurrentFrameIndex(index);
        setTokens(frames[index].tokens);
        setLines(frames[index].lines);
        setSelectedTokenId(null);
        setIsPlaying(false);
    }
  };

  const addNewFrame = () => {
    // 1. Pega o estado ATUAL da tela (tokens e posições)
    // Isso garante que os jogadores continuam exatamente onde estavam
    const currentTokens = JSON.parse(JSON.stringify(tokens)); // Deep copy segura
    
    // 2. Cria o novo frame com esses tokens, mas sem as linhas (limpa o desenho anterior)
    const newFrame: Frame = {
        tokens: currentTokens,
        lines: [] 
    };
    
    // 3. Adiciona e muda para ele
    const newFrames = [...frames, newFrame];
    setFrames(newFrames);
    
    // Atualiza estados
    setCurrentFrameIndex(newFrames.length - 1);
    setTokens(newFrame.tokens);
    setLines(newFrame.lines);
    setSelectedTokenId(null);
  };

  const deleteFrame = () => {
      if (frames.length > 1) {
          if(!confirm("Deseja apagar este frame?")) return;
          const newFrames = frames.filter((_, i) => i !== currentFrameIndex);
          setFrames(newFrames);
          const newIndex = currentFrameIndex >= newFrames.length ? newFrames.length - 1 : currentFrameIndex;
          setCurrentFrameIndex(newIndex);
          setTokens(newFrames[newIndex].tokens);
          setLines(newFrames[newIndex].lines);
      } else {
          updateCurrentFrame([], []); // Limpa se for o único
          alert("A jogada precisa ter pelo menos 1 frame.");
      }
  };

  // --- MANIPULAÇÃO DE TOKENS & DESENHO ---
  // (Lógica idêntica ao anterior, apenas chamando updateCurrentFrame)

  const addPlayerToCourt = (player: Player) => {
    const newToken: Token = {
      id: `${player.id}-${Date.now()}`, type: 'ancb', nome: player.nome, foto: player.foto,
      x: dimensions.width / 2 + (Math.random() * 40 - 20),
      y: dimensions.height / 2 + (Math.random() * 40 - 20)
    };
    updateCurrentFrame([...tokens, newToken], lines);
  };

  const handleDragEnd = (id: string, x: number, y: number) => {
    const newTokens = tokens.map(t => t.id === id ? { ...t, x, y } : t);
    updateCurrentFrame(newTokens, lines);
  };

  const removeSelectedToken = () => {
    if (!selectedTokenId) return;
    if (selectedTokenId.startsWith('rival-')) {
        const num = parseInt(selectedTokenId.split('-')[1]);
        handleDragEnd(selectedTokenId, 40, 100 + (num * 60)); 
    } else {
        const newTokens = tokens.filter(t => t.id !== selectedTokenId);
        updateCurrentFrame(newTokens, lines);
    }
    setSelectedTokenId(null);
  };

  const handleMouseDown = (e: any) => {
    const isPenInput = e.evt.pointerType === 'pen';
    if (tool === 'pen' || isPenInput) {
        setIsDrawing(true);
        if (isPenInput && tool !== 'pen') setTool('pen');
        const pos = e.target.getStage().getPointerPosition();
        const newLine = { tool: 'pen', color: lineColor, points: [pos.x, pos.y] };
        setLines([...lines, newLine]);
    }
  };

  const handleMouseMove = (e: any) => {
    if (!isDrawing) return;
    const stage = e.target.getStage();
    const point = stage.getPointerPosition();
    const lastLine = lines[lines.length - 1];
    if (lastLine) {
        lastLine.points = lastLine.points.concat([point.x, point.y]);
        lines.splice(lines.length - 1, 1, lastLine);
        setLines(lines.concat()); 
    }
  };

  const handleMouseUp = () => {
    if (isDrawing) {
        setIsDrawing(false);
        updateCurrentFrame(tokens, lines);
    }
  };

  const undoLastLine = () => {
      const newLines = lines.slice(0, -1);
      updateCurrentFrame(tokens, newLines);
  };

  const clearLines = () => {
      updateCurrentFrame(tokens, []);
  };

  // --- SAVES ---
  const savePlay = () => {
      if (!playName.trim()) return alert("Digite um nome!");
      const newPlay: SavedPlay = {
          id: Date.now().toString(), name: playName, courtType, frames, createdAt: Date.now()
      };
      const updatedPlays = [newPlay, ...savedPlays];
      setSavedPlays(updatedPlays);
      localStorage.setItem('ancb_plays', JSON.stringify(updatedPlays));
      setShowSaveModal(false); setPlayName(''); alert("Salvo!");
  };

  const loadSavedPlays = () => {
      const stored = localStorage.getItem('ancb_plays');
      if (stored) try { setSavedPlays(JSON.parse(stored)); } catch (e) {}
  };

  const loadPlay = (play: SavedPlay) => {
      setCourtType(play.courtType);
      setFrames(play.frames);
      changeFrame(0);
      setShowLoadModal(false);
  };
  
  const deleteSavedPlay = (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if(confirm("Apagar jogada?")) {
          const updated = savedPlays.filter(p => p.id !== id);
          setSavedPlays(updated);
          localStorage.setItem('ancb_plays', JSON.stringify(updated));
      }
  };

  // --- RENDERIZAÇÃO ---
  const renderWidth = dimensions.width; 
  let scale = 1, imgWidth = 0, imgHeight = 0, x = 0, y = 0, logoConfig = { w: 0, h: 0, x: 0, y: 0 };
  
  if (assets.lines && dimensions.width > 0) {
    scale = Math.min((renderWidth * 0.95) / assets.lines.width, (dimensions.height * 0.85) / assets.lines.height);
    imgWidth = assets.lines.width * scale;
    imgHeight = assets.lines.height * scale;
    x = (renderWidth - imgWidth) / 2;
    y = (dimensions.height - imgHeight) / 2 - 30; // Mais espaço embaixo para a timeline

    if (assets.logo) {
       const logoScale = (imgWidth * 0.20) / assets.logo.width;
       logoConfig.w = assets.logo.width * logoScale;
       logoConfig.h = assets.logo.height * logoScale;
       logoConfig.x = x + (imgWidth - logoConfig.w) / 2;
       logoConfig.y = y + (imgHeight - logoConfig.h) / 2;
    }
  }

  return (
    <div className="flex flex-col h-screen bg-slate-900 text-white font-sans overflow-hidden">
      
      {/* HEADER */}
      <header className="px-4 py-2 flex justify-between items-center bg-[#062553] border-b-4 border-[#041b3d] shadow-lg h-16 shrink-0 z-20">
        <div className="flex items-center gap-2">
            <img src={ASSETS_URLS.logo} alt="Logo" className="w-10 h-10 object-contain drop-shadow-md" />
            <div className="hidden sm:block">
                <h1 className="font-bold text-lg leading-tight">Prancheta Tática</h1>
                <p className="text-[10px] text-gray-300">Modo Offline</p>
            </div>
        </div>
        
        <div className="flex items-center gap-2">
            <button onClick={() => setShowLoadModal(true)} className="bg-slate-700 hover:bg-slate-600 px-3 py-2 rounded-lg text-white font-bold text-sm flex items-center gap-2 transition-colors">
                <FolderOpen size={18} /> <span className="hidden sm:inline">Jogadas</span>
            </button>
            <button onClick={() => setShowSaveModal(true)} className="bg-green-600 hover:bg-green-700 px-3 py-2 rounded-lg text-white font-bold text-sm flex items-center gap-2 shadow-lg transition-colors">
                <Save size={18} /> <span className="hidden sm:inline">Salvar</span>
            </button>
            <div className="w-px h-8 bg-slate-700 mx-1"></div>
             {selectedTokenId && (
                <button onClick={removeSelectedToken} className="bg-red-600 p-2 rounded-lg text-white shadow animate-pulse"><Trash2 size={20} /></button>
            )}
            <button onClick={() => setShowMenu(true)} className="bg-[#F27405] hover:bg-orange-600 text-white px-3 py-2 rounded-lg font-bold flex items-center gap-2 ml-1">
                <UserPlus size={20} />
            </button>
        </div>
      </header>

      {/* ÁREA PRINCIPAL */}
      <main className="flex-1 w-full relative bg-slate-800 flex overflow-hidden" ref={containerRef}>
        <div className="flex-1 relative">
            {dimensions.width > 0 && (
            <Stage 
                width={dimensions.width} height={dimensions.height} 
                onMouseDown={handleMouseDown} onMousemove={handleMouseMove} onMouseup={handleMouseUp}
                onTouchStart={handleMouseDown} onTouchMove={handleMouseMove} onTouchEnd={handleMouseUp}
                className={tool === 'pen' ? 'cursor-crosshair' : 'cursor-default'}
                onClick={(e) => { if (tool === 'cursor' && e.target === e.target.getStage()) setSelectedTokenId(null); }}
            >
                <Layer>
                     <Rect x={x} y={y} width={imgWidth} height={imgHeight} fillLinearGradientStartPoint={{ x: 0, y: 0 }} fillLinearGradientEndPoint={{ x: imgWidth, y: imgHeight }} fillLinearGradientColorStops={[0, '#2574d1', 1, '#1c64b6']} cornerRadius={5} />
                    {assets.logo && <KonvaImage image={assets.logo} width={logoConfig.w} height={logoConfig.h} x={logoConfig.x} y={logoConfig.y} opacity={0.3} listening={false} />}
                    {assets.lines && <KonvaImage image={assets.lines} width={imgWidth} height={imgHeight} x={x} y={y} listening={false} />}
                    
                    {lines.map((line, i) => (
                        <Line key={i} points={line.points} stroke={line.color} strokeWidth={4} tension={0.5} lineCap="round" lineJoin="round" opacity={0.8} />
                    ))}
                    {tokens.map(token => (
                        <PlayerToken key={token.id} token={token} onDragEnd={handleDragEnd} onSelect={setSelectedTokenId} isSelected={selectedTokenId === token.id} isLocked={tool === 'pen' || isPlaying} />
                    ))}
                </Layer>
            </Stage>
            )}
        </div>

        {/* FERRAMENTAS LATERAIS */}
        <div className="absolute right-4 top-1/2 transform -translate-y-1/2 bg-white dark:bg-gray-900 rounded-2xl shadow-2xl p-2 flex flex-col items-center gap-2 border border-gray-200 dark:border-gray-700 z-30">
            <button onClick={() => setTool('cursor')} className={`p-3 rounded-xl ${tool === 'cursor' ? 'bg-[#F27405] text-white' : 'text-gray-500'}`}><MousePointer2 size={24} /></button>
            <div className="h-px w-8 bg-gray-300 dark:bg-gray-700 my-1" />
            <div className="relative group">
                <button onClick={() => setTool('pen')} className={`p-3 rounded-xl ${tool === 'pen' ? 'bg-blue-600 text-white' : 'text-gray-500'}`}><Pencil size={24} /></button>
                {tool === 'pen' && (
                    <div className="absolute right-full top-0 mr-3 bg-white dark:bg-gray-800 p-2 rounded-xl shadow-xl flex flex-col gap-2">
                        {PEN_COLORS.map(c => <button key={c} onClick={(e) => { e.stopPropagation(); setLineColor(c); }} className={`w-6 h-6 rounded-full border border-white/20 ${lineColor === c ? 'ring-2 ring-blue-500 scale-110' : ''}`} style={{ backgroundColor: c }} />)}
                    </div>
                )}
            </div>
            <div className="h-px w-8 bg-gray-300 dark:bg-gray-700 my-1" />
            <button onClick={undoLastLine} className="p-3 rounded-xl text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"><Undo size={24} /></button>
            <button onClick={clearLines} className="p-3 rounded-xl text-gray-500 hover:text-red-600"><Eraser size={24} /></button>
        </div>

        {/* --- NOVA BARRA DE TIMELINE (THUMBNAILS) --- */}
        <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 bg-[#041b3d]/90 backdrop-blur-md text-white rounded-2xl shadow-2xl p-3 flex items-center gap-3 border border-white/10 z-30 overflow-x-auto max-w-[90vw]">
            
            {/* Botão de Play */}
            <button 
                onClick={() => setIsPlaying(!isPlaying)} 
                className={`p-3 rounded-xl transition-all ${isPlaying ? 'bg-red-500 hover:bg-red-600' : 'bg-green-500 hover:bg-green-600'}`}
                title={isPlaying ? "Pausar" : "Reproduzir Jogada"}
            >
                {isPlaying ? <Pause size={20} fill="white" /> : <Play size={20} fill="white" />}
            </button>

            <div className="w-px h-8 bg-white/20 mx-1"></div>

            {/* Lista de Frames (Quadradinhos) */}
            <div className="flex gap-2 items-center overflow-x-auto custom-scrollbar pb-1 px-1" style={{ maxWidth: '400px' }}>
                {frames.map((frame, index) => (
                    <button 
                        key={index}
                        onClick={() => changeFrame(index)}
                        className={`
                            relative w-10 h-10 rounded-lg font-bold text-sm flex items-center justify-center transition-all border-2
                            ${index === currentFrameIndex 
                                ? 'bg-[#F27405] border-[#F27405] text-white shadow-lg scale-110 z-10' // Ativo
                                : 'bg-white/10 border-transparent text-gray-300 hover:bg-white/20 hover:border-white/30' // Inativo
                            }
                        `}
                    >
                        {index + 1}
                        {/* Indicador se o frame tem desenho */}
                        {frame.lines.length > 0 && (
                            <div className="absolute bottom-1 w-1 h-1 bg-white rounded-full opacity-50"></div>
                        )}
                    </button>
                ))}
            </div>

            <div className="w-px h-8 bg-white/20 mx-1"></div>

            {/* Ações de Frame */}
            <div className="flex gap-2">
                <button 
                    onClick={addNewFrame} 
                    className="bg-blue-600 hover:bg-blue-500 p-2.5 rounded-xl text-white shadow-md transition-transform active:scale-95"
                    title="Duplicar frame atual"
                >
                    <Plus size={20} />
                </button>
                
                {frames.length > 1 && (
                    <button 
                        onClick={deleteFrame} 
                        className="text-red-400 hover:text-red-300 hover:bg-white/10 p-2.5 rounded-xl transition-colors" 
                        title="Apagar este frame"
                    >
                        <Trash2 size={20} />
                    </button>
                )}
            </div>
        </div>

      </main>

      {/* MODAL SALVAR */}
      {showSaveModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center backdrop-blur-sm p-4">
            <div className="bg-white dark:bg-gray-800 rounded-xl p-6 w-full max-w-sm shadow-2xl border border-gray-700">
                <h3 className="text-xl font-bold mb-4 text-gray-900 dark:text-white flex items-center gap-2"><Save size={20} className="text-green-500"/> Salvar Jogada</h3>
                <input 
                    autoFocus
                    type="text" 
                    placeholder="Nome da jogada (ex: Saída Lateral)" 
                    className="w-full p-3 rounded-lg bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white mb-4 outline-none focus:ring-2 focus:ring-[#F27405]"
                    value={playName}
                    onChange={(e) => setPlayName(e.target.value)}
                />
                <div className="flex gap-2 justify-end">
                    <button onClick={() => setShowSaveModal(false)} className="px-4 py-2 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">Cancelar</button>
                    <button onClick={savePlay} className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-bold">Salvar</button>
                </div>
            </div>
        </div>
      )}

      {/* MODAL CARREGAR */}
      {showLoadModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center backdrop-blur-sm p-4">
            <div className="bg-white dark:bg-gray-800 rounded-xl w-full max-w-md shadow-2xl border border-gray-700 flex flex-col max-h-[80vh]">
                <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
                    <h3 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2"><FolderOpen size={20} className="text-[#F27405]"/> Minhas Jogadas</h3>
                    <button onClick={() => setShowLoadModal(false)}><X size={24} className="text-gray-500"/></button>
                </div>
                <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                    {savedPlays.length === 0 ? <div className="text-center py-8 text-gray-500"><p>Nenhuma jogada salva ainda.</p></div> : (
                        <div className="space-y-2">
                            {savedPlays.map(play => (
                                <div key={play.id} onClick={() => loadPlay(play)} className="bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700 p-3 rounded-lg cursor-pointer border border-transparent hover:border-[#F27405] transition-all group flex justify-between items-center">
                                    <div>
                                        <p className="font-bold text-gray-800 dark:text-white">{play.name}</p>
                                        <p className="text-xs text-gray-500">{new Date(play.createdAt).toLocaleDateString()} • {play.frames.length} frames</p>
                                    </div>
                                    <button onClick={(e) => deleteSavedPlay(play.id, e)} className="p-2 text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 size={18} /></button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
      )}

      {/* MENU JOGADORES */}
      {showMenu && (
        <>
            <div className="fixed inset-0 bg-black/50 z-40" onClick={() => setShowMenu(false)} />
            <div className="fixed top-0 right-0 h-full w-80 bg-white dark:bg-gray-900 shadow-2xl z-50 flex flex-col border-l border-gray-700">
                <div className="p-4 border-b border-gray-800 flex justify-between items-center bg-[#062553]">
                    <h2 className="font-bold text-white text-lg flex items-center gap-2"><UserPlus size={20} className="text-[#F27405]" /> Elenco</h2>
                    <button onClick={() => setShowMenu(false)} className="text-gray-300 hover:text-white"><X size={24} /></button>
                </div>
                <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                    <div className="grid gap-2">
                        {dbPlayers.map(player => (
                            <button key={player.id} onClick={() => addPlayerToCourt(player)} className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-800 transition-colors group text-left w-full">
                                <div className="w-10 h-10 rounded-full overflow-hidden border-2 border-[#062553] bg-gray-200"><img src={player.foto || `${ASSETS_URLS.defaultAvatar}${player.nome}`} alt={player.nome} className="w-full h-full object-cover" /></div>
                                <div><p className="font-bold text-gray-200 text-sm">{player.nome}</p></div>
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        </>
      )}
    </div>
  );
};

export default App;