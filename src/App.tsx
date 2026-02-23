import React, { useState, useEffect, useRef } from 'react';
import { Stage, Layer, Image as KonvaImage, Group, Circle, Text, Rect, Line } from 'react-konva';
import { UserPlus, X, Trash2, Pencil, MousePointer2, Undo, Eraser, Save, FolderOpen, Plus } from 'lucide-react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from './services/firebase';

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
  type: 'ancb' | 'rival' | 'ancb-generic';
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

// 3 cores: vermelho saturado, preto, branco
const PEN_COLORS = ['#ff0000', '#000000', '#ffffff'];

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
    if (token.type === 'rival' || token.type === 'ancb-generic') {
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
  const isGeneric = token.type === 'ancb-generic';
  const mainColor = isOpponent ? '#ef4444' : '#062553';
  const strokeColor = isOpponent ? '#991b1b' : '#041b3d';
  const showText = isOpponent || isGeneric || status !== 'loaded';

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
        <Text
          text={(isOpponent || isGeneric) ? token.numero?.toString() : token.nome?.charAt(0).toUpperCase()}
          fontSize={20} fontStyle="bold" fill="white" align="center" verticalAlign="middle" offsetX={6} offsetY={8} listening={false}
        />
      )}
      {!isOpponent && !isGeneric && token.nome && (
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
  const penButtonRef = useRef<HTMLButtonElement>(null);

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

  // Ferramentas
  const [tool, setTool] = useState<'cursor' | 'pen'>('cursor');
  const [lineColor, setLineColor] = useState('#ff0000');
  const [isDrawing, setIsDrawing] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [colorPickerPos, setColorPickerPos] = useState({ top: 0, right: 0 });

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
        const sidebarWidth = 85;
        setDimensions({
            width: containerRef.current.offsetWidth - sidebarWidth,
            height: containerRef.current.offsetHeight
        });

        if (tokens.length === 0 && frames[0].tokens.length === 0) {
            const rivals: Token[] = [1, 2, 3, 4, 5].map(num => ({
                id: `rival-${num}`, type: 'rival' as const, numero: num, x: 38, y: 90 + (num * 58)
            }));
            const generics: Token[] = [1, 2, 3, 4, 5].map(num => ({
                id: `ancb-generic-${num}`, type: 'ancb-generic' as const, numero: num, x: 82, y: 90 + (num * 58)
            }));
            updateCurrentFrame([...rivals, ...generics], []);
        }
      }
    };
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  // Fecha o color picker ao clicar fora
  useEffect(() => {
    const handleClickOutside = () => {
      if (showColorPicker) setShowColorPicker(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showColorPicker]);

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
    }
  };

  const addNewFrame = () => {
    const currentTokens = JSON.parse(JSON.stringify(tokens));
    const newFrame: Frame = {
        tokens: currentTokens,
        lines: []
    };
    const newFrames = [...frames, newFrame];
    setFrames(newFrames);
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
      }
  };

  // --- MANIPULAÇÃO DE TOKENS & DESENHO ---

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
        handleDragEnd(selectedTokenId, 38, 90 + (num * 58));
    } else if (selectedTokenId.startsWith('ancb-generic-')) {
        const num = parseInt(selectedTokenId.split('-')[2]);
        handleDragEnd(selectedTokenId, 82, 90 + (num * 58));
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

  // Abre o color picker posicionado fixo na tela, à esquerda do botão
  const handlePenButtonClick = () => {
    const newTool = tool === 'pen' ? 'pen' : 'pen';
    setTool(newTool);

    if (tool !== 'pen') {
      // Ativando a caneta: mostra color picker
      if (penButtonRef.current) {
        const rect = penButtonRef.current.getBoundingClientRect();
        setColorPickerPos({
          top: rect.top,
          right: window.innerWidth - rect.left + 8,
        });
      }
      setShowColorPicker(true);
    } else {
      // Já estava na caneta: toggle color picker
      if (showColorPicker) {
        setShowColorPicker(false);
      } else {
        if (penButtonRef.current) {
          const rect = penButtonRef.current.getBoundingClientRect();
          setColorPickerPos({
            top: rect.top,
            right: window.innerWidth - rect.left + 8,
          });
        }
        setShowColorPicker(true);
      }
    }
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
  let scale = 1, imgWidth = 0, imgHeight = 0, x = 0, y = 0, logoConfig = { w: 0, h: 0, x: 0, y: 0 };

  if (assets.lines && dimensions.width > 0) {
    scale = Math.min((dimensions.width * 0.95) / assets.lines.width, (dimensions.height * 0.95) / assets.lines.height);
    imgWidth = assets.lines.width * scale;
    imgHeight = assets.lines.height * scale;
    x = (dimensions.width - imgWidth) / 2;
    y = (dimensions.height - imgHeight) / 2;

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
            {/* Seletor de tipo de quadra */}
            <div className="flex items-center bg-slate-800 rounded-lg p-1 gap-1 border border-slate-600">
                <button
                  onClick={() => setCourtType('half')}
                  className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${courtType === 'half' ? 'bg-[#F27405] text-white shadow' : 'text-gray-400 hover:text-white'}`}
                >
                  ½ Quadra
                </button>
                <button
                  onClick={() => setCourtType('full')}
                  className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${courtType === 'full' ? 'bg-[#F27405] text-white shadow' : 'text-gray-400 hover:text-white'}`}
                >
                  Quadra Toda
                </button>
            </div>

            <div className="w-px h-8 bg-slate-700 mx-1"></div>

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

        {/* LADO ESQUERDO: QUADRA */}
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
                        <PlayerToken key={token.id} token={token} onDragEnd={handleDragEnd} onSelect={setSelectedTokenId} isSelected={selectedTokenId === token.id} isLocked={tool === 'pen'} />
                    ))}
                </Layer>
            </Stage>
            )}
        </div>

        {/* --- BARRA LATERAL UNIFICADA (FERRAMENTAS + TIMELINE) --- */}
        <div className="w-[85px] bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-700 flex flex-col items-center py-4 gap-4 z-30 shrink-0 overflow-y-auto custom-scrollbar">

            {/* Ferramentas de Desenho */}
            <div className="flex flex-col items-center gap-2">
                <button
                  onClick={() => { setTool('cursor'); setShowColorPicker(false); }}
                  className={`p-3 rounded-xl transition-all ${tool === 'cursor' ? 'bg-[#F27405] text-white shadow-lg' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'}`}
                >
                    <MousePointer2 size={24} />
                </button>

                {/* Botão caneta com indicador da cor atual */}
                <div className="relative">
                    <button
                      ref={penButtonRef}
                      onClick={handlePenButtonClick}
                      className={`p-3 rounded-xl transition-all ${tool === 'pen' ? 'bg-blue-600 text-white shadow-lg' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'}`}
                    >
                        <Pencil size={24} />
                    </button>
                    {/* Bolinha indicando a cor selecionada */}
                    <span
                      className="absolute bottom-1 right-1 w-3 h-3 rounded-full border-2 border-gray-700 pointer-events-none"
                      style={{ backgroundColor: lineColor }}
                    />
                </div>

                <button onClick={undoLastLine} className="p-3 rounded-xl text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"><Undo size={24} /></button>
                <button onClick={clearLines} className="p-3 rounded-xl text-gray-500 hover:text-red-600 transition-colors"><Eraser size={24} /></button>
            </div>

            <div className="h-px w-10 bg-gray-300 dark:bg-gray-700 my-1" />

            {/* Timeline Vertical (Quadradinhos) */}
            <div className="flex flex-col gap-3 items-center w-full">
                <div className="flex flex-col gap-2 w-full px-2 overflow-y-auto">
                    {frames.map((frame, index) => (
                        <button
                            key={index}
                            onClick={() => changeFrame(index)}
                            className={`
                                relative w-12 h-12 rounded-lg font-bold text-sm flex items-center justify-center transition-all border-2 shrink-0 mx-auto
                                ${index === currentFrameIndex
                                    ? 'bg-[#F27405] border-[#F27405] text-white shadow-lg'
                                    : 'bg-gray-100 dark:bg-white/10 border-transparent text-gray-500 dark:text-gray-300 hover:bg-white/20 hover:border-white/30'
                                }
                            `}
                        >
                            {index + 1}
                            {frame.lines.length > 0 && <div className="absolute bottom-1 w-1 h-1 bg-white rounded-full opacity-50"></div>}
                        </button>
                    ))}
                </div>

                <button onClick={addNewFrame} className="bg-blue-600 hover:bg-blue-500 p-3 rounded-full text-white shadow-md transition-transform active:scale-95" title="Novo Frame">
                    <Plus size={24} />
                </button>

                {frames.length > 1 && (
                    <button onClick={deleteFrame} className="text-red-400 hover:text-red-300 hover:bg-white/10 p-2 rounded-lg transition-colors" title="Apagar frame">
                        <Trash2 size={20} />
                    </button>
                )}
            </div>
        </div>
      </main>

      {/* COLOR PICKER — fixo na tela, sempre na frente de tudo */}
      {showColorPicker && (
        <div
          className="fixed flex flex-col gap-2 bg-gray-800 p-3 rounded-2xl shadow-2xl border border-gray-600"
          style={{
            top: colorPickerPos.top,
            right: colorPickerPos.right,
            zIndex: 9999,
          }}
          onMouseDown={(e) => e.stopPropagation()} // impede fechar ao clicar dentro
        >
          {PEN_COLORS.map(c => (
            <button
              key={c}
              onClick={() => { setLineColor(c); setShowColorPicker(false); }}
              className="w-8 h-8 rounded-full border-2 transition-transform hover:scale-110 active:scale-95"
              style={{
                backgroundColor: c,
                borderColor: lineColor === c ? '#F27405' : 'rgba(255,255,255,0.2)',
                boxShadow: lineColor === c ? '0 0 0 2px #F27405' : 'none',
              }}
            />
          ))}
        </div>
      )}

      {/* MODAL SALVAR */}
      {showSaveModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center backdrop-blur-sm p-4">
            <div className="bg-white dark:bg-gray-800 rounded-xl p-6 w-full max-w-sm shadow-2xl border border-gray-700">
                <h3 className="text-xl font-bold mb-4 text-gray-900 dark:text-white flex items-center gap-2"><Save size={20} className="text-green-500"/> Salvar Jogada</h3>
                <input autoFocus type="text" placeholder="Nome da jogada" className="w-full p-3 rounded-lg bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white mb-4 outline-none focus:ring-2 focus:ring-[#F27405]" value={playName} onChange={(e) => setPlayName(e.target.value)} />
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
                <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center text-gray-900 dark:text-white">
                    <h3 className="text-xl font-bold flex items-center gap-2"><FolderOpen size={20} className="text-[#F27405]"/> Minhas Jogadas</h3>
                    <button onClick={() => setShowLoadModal(false)}><X size={24} /></button>
                </div>
                <div className="flex-1 overflow-y-auto p-4">
                    {savedPlays.length === 0 ? <p className="text-center py-8 text-gray-500">Nenhuma jogada salva.</p> : (
                        <div className="space-y-2">
                            {savedPlays.map(play => (
                                <div key={play.id} onClick={() => loadPlay(play)} className="bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700 p-3 rounded-lg cursor-pointer border border-transparent hover:border-[#F27405] transition-all group flex justify-between items-center text-gray-900 dark:text-white">
                                    <div><p className="font-bold">{play.name}</p><p className="text-xs text-gray-500">{play.frames.length} frames</p></div>
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
                            <button key={player.id} onClick={() => addPlayerToCourt(player)} className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-800 transition-colors group text-left w-full text-white">
                                <div className="w-10 h-10 rounded-full overflow-hidden border-2 border-[#062553] bg-gray-200"><img src={player.foto || `${ASSETS_URLS.defaultAvatar}${player.nome}`} alt={player.nome} className="w-full h-full object-cover" /></div>
                                <div><p className="font-bold text-sm">{player.nome}</p></div>
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
