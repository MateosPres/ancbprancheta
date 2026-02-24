import React, { useState, useEffect, useRef } from 'react';
import { Stage, Layer, Image as KonvaImage, Group, Circle, Text, Rect, Line } from 'react-konva';
import { UserPlus, X, Trash2, Undo, Eraser, Save, FolderOpen, Plus } from 'lucide-react';
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
  type: 'ancb' | 'rival' | 'generic';
  // Posição normalizada (0-1) relativa ao canvas — sobrevive redimensionamento
  xRatio: number;
  yRatio: number;
  nome?: string;
  foto?: string | null;
  numero?: number;
}

interface DrawnLine {
  tool: string;
  color: string;
  pointRatios: number[]; // alternados x/y normalizados
}

interface Frame {
  courtType: 'half' | 'full';
  tokens: Token[];
  lines: DrawnLine[];
}

interface SavedPlay {
  id: string;
  name: string;
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

const PEN_COLORS = ['#ff0000', '#000000', '#ffffff', '#ffff00', '#00ff00'];

// Tokens laterais: xRatio fixo próximo à borda esquerda do canvas
const SIDEBAR_X = 0.044;

const buildDefaultTokens = (): Token[] => {
  const rivals: Token[] = [1, 2, 3, 4, 5].map((num, i) => ({
    id: `rival-${num}`, type: 'rival' as const, numero: num,
    xRatio: SIDEBAR_X, yRatio: 0.07 + i * 0.09,
  }));
  const generics: Token[] = [1, 2, 3, 4, 5].map((num, i) => ({
    id: `generic-${num}`, type: 'generic' as const, numero: num,
    xRatio: SIDEBAR_X, yRatio: 0.52 + i * 0.09,
  }));
  return [...rivals, ...generics];
};

// ============================================================================
// COMPONENTE TOKEN
// ============================================================================

interface PlayerTokenProps {
  token: Token;
  canvasW: number;
  canvasH: number;
  onDragEnd: (id: string, xRatio: number, yRatio: number) => void;
  onSelect: (id: string) => void;
  isSelected: boolean;
}

const PlayerToken: React.FC<PlayerTokenProps> = ({ token, canvasW, canvasH, onDragEnd, onSelect, isSelected }) => {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading');

  useEffect(() => {
    if (token.type !== 'ancb') { setStatus('error'); return; }
    const img = new window.Image();
    const src = token.foto || `${ASSETS_URLS.defaultAvatar}${token.nome}`;
    if (!src.startsWith('data:')) {
      img.crossOrigin = 'Anonymous';
      img.src = `${src}${src.includes('?') ? '&' : '?'}t=${Date.now()}`;
    } else {
      img.src = src;
    }
    img.onload = () => { if (img.width > 0) { setImage(img); setStatus('loaded'); } else setStatus('error'); };
    img.onerror = () => setStatus('error');
  }, [token.foto, token.nome, token.type]);

  const px = token.xRatio * canvasW;
  const py = token.yRatio * canvasH;
  const radius = 22;
  const isOpponent = token.type === 'rival';
  const isGeneric = token.type === 'generic';
  const mainColor = isOpponent ? '#ef4444' : isGeneric ? '#1e3a5f' : '#062553';
  const strokeColor = isOpponent ? '#991b1b' : isGeneric ? '#0f1f33' : '#041b3d';
  const showText = isOpponent || isGeneric || status !== 'loaded';

  return (
    <Group
      draggable
      x={px} y={py}
      onDragEnd={e => onDragEnd(token.id, e.target.x() / canvasW, e.target.y() / canvasH)}
      onClick={e => { e.cancelBubble = true; onSelect(token.id); }}
      onTap={e => { e.cancelBubble = true; onSelect(token.id); }}
    >
      <Circle radius={radius} fill="black" opacity={0.3} offsetX={-2} offsetY={-2} />
      {showText && <Circle radius={radius} fill={mainColor} />}
      {!showText && image && (
        <KonvaImage image={image} width={radius * 2} height={radius * 2} x={-radius} y={-radius} cornerRadius={radius} />
      )}
      <Circle radius={radius} stroke={isSelected ? '#F27405' : strokeColor} strokeWidth={isSelected ? 4 : 2} fillEnabled={false} />
      {showText && (
        <Text
          text={isOpponent || isGeneric ? token.numero?.toString() : token.nome?.charAt(0).toUpperCase()}
          fontSize={20} fontStyle="bold" fill="white" align="center" verticalAlign="middle"
          offsetX={6} offsetY={8} listening={false}
        />
      )}
      {token.type === 'ancb' && token.nome && (
        <Text
          text={token.nome.split(' ')[0]} y={radius + 5} fontSize={10}
          fill="white" align="center" width={80} offsetX={40}
          shadowColor="black" shadowBlur={3} listening={false}
        />
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

  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [assets, setAssets] = useState<Assets>({ lines: null, logo: null });
  const [dbPlayers, setDbPlayers] = useState<Player[]>([]);
  const [showMenu, setShowMenu] = useState(false);
  const [selectedTokenId, setSelectedTokenId] = useState<string | null>(null);

  const [frames, setFrames] = useState<Frame[]>([{
    courtType: 'half',
    tokens: buildDefaultTokens(),
    lines: []
  }]);
  const [currentFrameIndex, setCurrentFrameIndex] = useState(0);

  const currentFrame = frames[currentFrameIndex];
  const tokens = currentFrame.tokens;
  const lines = currentFrame.lines;
  const courtType = currentFrame.courtType;

  // Layout adapts to orientation — toolbar goes bottom in portrait, right in landscape
  const isPortrait = dimensions.height > dimensions.width;

  const [lineColor, setLineColor] = useState('#ff0000');
  const [isDrawing, setIsDrawing] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [colorPickerPos, setColorPickerPos] = useState({ top: 0, right: 0 });
  const touchStartRef = useRef<{ tokenId: string | null } | null>(null);
  const isActuallyDrawingRef = useRef(false);

  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showLoadModal, setShowLoadModal] = useState(false);
  const [playName, setPlayName] = useState('');
  const [savedPlays, setSavedPlays] = useState<SavedPlay[]>([]);

  // Buscar jogadores e jogadas salvas
  useEffect(() => {
    const fetchPlayers = async () => {
      try {
        const snap = await getDocs(collection(db, "jogadores"));
        const list = snap.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Player[];
        setDbPlayers(list.sort((a, b) => a.nome.localeCompare(b.nome)));
      } catch (e) { console.error(e); }
    };
    fetchPlayers();
    const stored = localStorage.getItem('ancb_plays');
    if (stored) try { setSavedPlays(JSON.parse(stored)); } catch (_) {}
  }, []);

  // Carregar assets quando courtType muda
  useEffect(() => {
    const imgLines = new window.Image();
    imgLines.crossOrigin = 'Anonymous';
    imgLines.src = courtType === 'half' ? ASSETS_URLS.courtHalf : ASSETS_URLS.courtFull;
    const imgLogo = new window.Image();
    imgLogo.crossOrigin = 'Anonymous';
    imgLogo.src = ASSETS_URLS.logo;
    Promise.all([
      new Promise(r => { imgLines.onload = r; imgLines.onerror = r; }),
      new Promise(r => { imgLogo.onload = r; imgLogo.onerror = r; })
    ]).then(() => setAssets({ lines: imgLines, logo: imgLogo }));
  }, [courtType]);

  // Responsividade — sempre baseado no tamanho real do container
  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        const w = containerRef.current.offsetWidth;
        const h = containerRef.current.offsetHeight;
        const portrait = h > w;
        setDimensions({
          width: portrait ? w : w - 72,
          height: portrait ? h - 60 : h,
        });
      }
    };
    updateSize();
    window.addEventListener('resize', updateSize);
    // Também detectar mudança de orientação
    window.addEventListener('orientationchange', () => setTimeout(updateSize, 200));
    return () => {
      window.removeEventListener('resize', updateSize);
      window.removeEventListener('orientationchange', updateSize);
    };
  }, []);

  // Fechar color picker ao clicar fora
  useEffect(() => {
    const h = () => { if (showColorPicker) setShowColorPicker(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [showColorPicker]);

  // ============================================================================
  // MUTAÇÃO DE FRAMES
  // ============================================================================

  const updateCurrentFrame = (patch: Partial<Frame>) => {
    setFrames(prev => {
      const next = [...prev];
      next[currentFrameIndex] = { ...next[currentFrameIndex], ...patch };
      return next;
    });
  };

  const setCourtType = (ct: 'half' | 'full') => {
    updateCurrentFrame({ courtType: ct });
    const imgLines = new window.Image();
    imgLines.crossOrigin = 'Anonymous';
    imgLines.src = ct === 'half' ? ASSETS_URLS.courtHalf : ASSETS_URLS.courtFull;
    imgLines.onload = () => setAssets(prev => ({ ...prev, lines: imgLines }));
  };

  const changeFrame = (index: number) => {
    if (index >= 0 && index < frames.length) {
      setCurrentFrameIndex(index);
      setSelectedTokenId(null);
    }
  };

  // Ao mudar de frame, o courtType muda → useEffect recarrega asset automaticamente

  const addNewFrame = () => {
    // Novo frame: copia tokens (posições preservadas), sem linhas, mesmo courtType
    const tokensCopy: Token[] = JSON.parse(JSON.stringify(tokens));
    const newFrame: Frame = { courtType, tokens: tokensCopy, lines: [] };
    setFrames(prev => {
      const next = [...prev, newFrame];
      setCurrentFrameIndex(next.length - 1);
      return next;
    });
    setSelectedTokenId(null);
  };

  const deleteFrame = () => {
    if (frames.length <= 1) return;
    if (!confirm("Deseja apagar este frame?")) return;
    setFrames(prev => {
      const next = prev.filter((_, i) => i !== currentFrameIndex);
      const ni = Math.min(currentFrameIndex, next.length - 1);
      setCurrentFrameIndex(ni);
      return next;
    });
  };

  // ============================================================================
  // TOKENS
  // ============================================================================

  const addPlayerToCourt = (player: Player) => {
    // Não fecha o menu — usuário clica em vários e fecha quando quiser
    const ancbTokens = tokens.filter(t => t.type === 'ancb');
    // Se jogador já está na quadra, ignora
    if (ancbTokens.some(t => t.nome === player.nome)) return;

    const count = ancbTokens.length;
    const total = count + 1;
    const spacingR = 0.10;
    const rowW = (total - 1) * spacingR;

    // Recentrar existentes
    const updatedTokens = tokens.map(t => {
      if (t.type !== 'ancb') return t;
      const idx = ancbTokens.findIndex(at => at.id === t.id);
      return { ...t, xRatio: 0.5 - rowW / 2 + idx * spacingR, yRatio: 0.07 };
    });

    const newToken: Token = {
      id: `${player.id}-${Date.now()}`, type: 'ancb',
      nome: player.nome, foto: player.foto ?? null,
      xRatio: 0.5 - rowW / 2 + count * spacingR,
      yRatio: 0.07
    };

    updateCurrentFrame({ tokens: [...updatedTokens, newToken] });
  };

  const handleDragEnd = (id: string, xRatio: number, yRatio: number) => {
    // Clampar para não sair do canvas
    const clampedX = Math.max(0.02, Math.min(0.98, xRatio));
    const clampedY = Math.max(0.02, Math.min(0.98, yRatio));
    updateCurrentFrame({ tokens: tokens.map(t => t.id === id ? { ...t, xRatio: clampedX, yRatio: clampedY } : t) });
  };

  const removeSelectedToken = () => {
    if (!selectedTokenId) return;
    if (selectedTokenId.startsWith('rival-')) {
      const num = parseInt(selectedTokenId.split('-')[1]);
      updateCurrentFrame({ tokens: tokens.map(t => t.id === selectedTokenId ? { ...t, xRatio: SIDEBAR_X, yRatio: 0.07 + (num - 1) * 0.09 } : t) });
    } else if (selectedTokenId.startsWith('generic-')) {
      const num = parseInt(selectedTokenId.split('-')[1]);
      updateCurrentFrame({ tokens: tokens.map(t => t.id === selectedTokenId ? { ...t, xRatio: SIDEBAR_X, yRatio: 0.52 + (num - 1) * 0.09 } : t) });
    } else {
      updateCurrentFrame({ tokens: tokens.filter(t => t.id !== selectedTokenId) });
    }
    setSelectedTokenId(null);
  };

  // ============================================================================
  // FERRAMENTA MULTIUSO (toque em área vazia = desenha / toque em token = move)
  // ============================================================================

  const getTokenAtPosition = (x: number, y: number): string | null => {
    const hit = 30;
    for (const t of tokens) {
      const dx = t.xRatio * stageW - x;
      const dy = t.yRatio * stageH - y;
      if (Math.sqrt(dx * dx + dy * dy) <= hit) return t.id;
    }
    return null;
  };

  const handlePointerDown = (e: any) => {
    const rawPos = e.target.getStage()?.getPointerPosition();
    if (!rawPos) return;
    const pos = rawPos; // Konva already handles internal coords correctly
    const tokenId = getTokenAtPosition(pos.x, pos.y);
    touchStartRef.current = { tokenId };
    isActuallyDrawingRef.current = false;
    if (!tokenId) {
      isActuallyDrawingRef.current = true;
      setIsDrawing(true);
      const newLine: DrawnLine = {
        tool: 'pen', color: lineColor,
        pointRatios: [pos.x / stageW, pos.y / stageH]
      };
      updateCurrentFrame({ lines: [...lines, newLine] });
    }
  };

  const handlePointerMove = (e: any) => {
    if (!isActuallyDrawingRef.current || !isDrawing) return;
    const pos = e.target.getStage()?.getPointerPosition();
    if (!pos) return;
    setFrames(prev => {
      const next = [...prev];
      const frame = { ...next[currentFrameIndex] };
      const newLines = [...frame.lines];
      const last = { ...newLines[newLines.length - 1] };
      last.pointRatios = [...last.pointRatios, pos.x / stageW, pos.y / stageH];
      newLines[newLines.length - 1] = last;
      frame.lines = newLines;
      next[currentFrameIndex] = frame;
      return next;
    });
  };

  const handlePointerUp = () => {
    setIsDrawing(false);
    touchStartRef.current = null;
    isActuallyDrawingRef.current = false;
  };

  const undoLastLine = () => updateCurrentFrame({ lines: lines.slice(0, -1) });
  const clearLines = () => updateCurrentFrame({ lines: [] });

  const handleColorButtonClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (penButtonRef.current) {
      const rect = penButtonRef.current.getBoundingClientRect();
      setColorPickerPos({ top: rect.top, right: window.innerWidth - rect.left + 8 });
    }
    setShowColorPicker(p => !p);
  };

  // ============================================================================
  // SAVES
  // ============================================================================

  const savePlay = () => {
    if (!playName.trim()) return alert("Digite um nome!");
    const newPlay: SavedPlay = { id: Date.now().toString(), name: playName, frames, createdAt: Date.now() };
    const updated = [newPlay, ...savedPlays];
    setSavedPlays(updated);
    localStorage.setItem('ancb_plays', JSON.stringify(updated));
    setShowSaveModal(false); setPlayName(''); alert("Salvo!");
  };

  const loadPlay = (play: SavedPlay) => {
    setFrames(play.frames);
    setCurrentFrameIndex(0);
    setShowLoadModal(false);
  };

  const deleteSavedPlay = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm("Apagar jogada?")) {
      const updated = savedPlays.filter(p => p.id !== id);
      setSavedPlays(updated);
      localStorage.setItem('ancb_plays', JSON.stringify(updated));
    }
  };

  // ============================================================================
  // CÁLCULO DA QUADRA
  // O Stage é sempre renderizado como se fosse landscape.
  // Em portrait, passamos as dimensões invertidas (height como width e vice-versa)
  // para o Stage, e giramos o elemento via CSS transform.
  // ============================================================================

  // Dimensões "lógicas" do Stage — sempre landscape (larga e curta)
  const stageW = isPortrait ? dimensions.height : dimensions.width;
  const stageH = isPortrait ? dimensions.width  : dimensions.height;

  let imgWidth = 0, imgHeight = 0, courtX = 0, courtY = 0;
  let logoConfig = { w: 0, h: 0, x: 0, y: 0 };

  if (assets.lines && stageW > 0) {
    const scale = Math.min(
      (stageW * 0.99) / assets.lines.width,
      (stageH * 0.99) / assets.lines.height
    );
    imgWidth = assets.lines.width * scale;
    imgHeight = assets.lines.height * scale;
    courtX = (stageW - imgWidth) / 2;
    courtY = (stageH - imgHeight) / 2;
    if (assets.logo) {
      const ls = (imgWidth * 0.22) / assets.logo.width;
      logoConfig = {
        w: assets.logo.width * ls,
        h: assets.logo.height * ls,
        x: courtX + (imgWidth - assets.logo.width * ls) / 2,
        y: courtY + (imgHeight - assets.logo.height * ls) / 2,
      };
    }
  }

  // Converter linhas normalizadas para pixels
  const renderLines = lines.map(l => ({
    ...l,
    points: l.pointRatios.reduce((acc: number[], v, i) => {
      acc.push(i % 2 === 0 ? v * stageW : v * stageH);
      return acc;
    }, [])
  }));

  // ============================================================================
  // RENDER
  // ============================================================================
  return (
    <div
      className="flex flex-col bg-slate-900 text-white font-sans"
      style={{
        userSelect: 'none',
        WebkitUserSelect: 'none',
        // Trava orientação landscape via CSS — a quadra sempre fica horizontal
        width: '100vw',
        height: '100vh',
        overflow: 'hidden',
        // Força layout landscape mesmo se o SO girar
        maxWidth: '100vw',
        maxHeight: '100vh',
      }}
    >
      {/* HEADER */}
      <header className="px-3 py-2 flex justify-between items-center bg-[#062553] border-b-4 border-[#041b3d] shadow-lg shrink-0 z-20" style={{ height: 56 }}>
        <div className="flex items-center gap-2">
          <img src={ASSETS_URLS.logo} alt="Logo" className="w-9 h-9 object-contain drop-shadow-md" />
          <div>
            <h1 className="font-bold text-sm leading-tight">Prancheta ANCB</h1>
            <p className="text-[10px] text-gray-300">Modo Offline</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowLoadModal(true)}
            className="bg-slate-700 hover:bg-slate-600 px-2.5 py-1.5 rounded-lg text-white font-bold text-xs flex items-center gap-1 transition-colors"
          >
            <FolderOpen size={15} /><span>Jogadas</span>
          </button>
          <button
            onClick={() => setShowSaveModal(true)}
            className="bg-green-600 hover:bg-green-700 px-2.5 py-1.5 rounded-lg text-white font-bold text-xs flex items-center gap-1 shadow-lg transition-colors"
          >
            <Save size={15} /><span>Salvar</span>
          </button>
          {selectedTokenId && (
            <button onClick={removeSelectedToken} className="bg-red-600 p-1.5 rounded-lg text-white shadow animate-pulse">
              <Trash2 size={16} />
            </button>
          )}
          <button
            onClick={() => setShowMenu(true)}
            className="bg-[#F27405] hover:bg-orange-600 text-white px-2.5 py-1.5 rounded-lg font-bold flex items-center gap-1"
          >
            <UserPlus size={16} />
          </button>
        </div>
      </header>

      {/* ÁREA PRINCIPAL */}
      <main
        className="flex-1 w-full relative bg-slate-800 overflow-hidden"
        ref={containerRef}
        style={{ display: 'flex', flexDirection: isPortrait ? 'column' : 'row' }}
      >

        {/* CANVAS DA QUADRA */}
        <div className="flex-1 relative overflow-hidden">
          {dimensions.width > 0 && (
            <Stage
              width={stageW} height={stageH}
              onMouseDown={handlePointerDown} onMousemove={handlePointerMove} onMouseup={handlePointerUp}
              onTouchStart={handlePointerDown} onTouchMove={handlePointerMove} onTouchEnd={handlePointerUp}
              style={{
                cursor: 'crosshair',
                touchAction: 'none',
                display: 'block',
                // Em portrait: gira o canvas 90° e reposiciona para ocupar o espaço certo
                ...(isPortrait ? {
                  transformOrigin: 'top left',
                  transform: `rotate(90deg) translateY(-100%)`,
                  position: 'absolute',
                  top: 0,
                  left: 0,
                } : {})
              }}
              onClick={e => { if (e.target === e.target.getStage()) setSelectedTokenId(null); }}
            >
              <Layer>
                {/* Quadra sempre landscape — a rotação da UI é feita via CSS no index.html */}
                <Rect
                  x={courtX} y={courtY} width={imgWidth} height={imgHeight}
                  fillLinearGradientStartPoint={{ x: 0, y: 0 }}
                  fillLinearGradientEndPoint={{ x: imgWidth, y: imgHeight }}
                  fillLinearGradientColorStops={[0, '#2574d1', 1, '#1c64b6']}
                  cornerRadius={5}
                />
                {assets.logo && (
                  <KonvaImage
                    image={assets.logo} width={logoConfig.w} height={logoConfig.h}
                    x={logoConfig.x} y={logoConfig.y} opacity={0.3} listening={false}
                  />
                )}
                {assets.lines && (
                  <KonvaImage
                    image={assets.lines} width={imgWidth} height={imgHeight}
                    x={courtX} y={courtY} listening={false}
                  />
                )}
                {renderLines.map((line, i) => (
                  <Line key={i} points={line.points} stroke={line.color} strokeWidth={4}
                    tension={0.5} lineCap="round" lineJoin="round" opacity={0.9} listening={false} />
                ))}
                {tokens.map(token => (
                  <PlayerToken
                    key={token.id} token={token}
                    canvasW={stageW} canvasH={stageH}
                    onDragEnd={handleDragEnd} onSelect={setSelectedTokenId}
                    isSelected={selectedTokenId === token.id}
                  />
                ))}
              </Layer>
            </Stage>
          )}
        </div>

        {/* BARRA DE FERRAMENTAS — direita em landscape, baixo em portrait */}
        <div
          className="bg-gray-900 z-30 shrink-0 flex items-center gap-2"
          style={isPortrait ? {
            // Portrait: barra horizontal na base
            flexDirection: 'row',
            width: '100%',
            height: 60,
            borderTop: '1px solid #374151',
            paddingLeft: 8,
            paddingRight: 8,
            overflowX: 'auto',
          } : {
            // Landscape: barra vertical na direita
            flexDirection: 'column',
            width: 72,
            height: '100%',
            borderLeft: '1px solid #374151',
            paddingTop: 12,
            paddingBottom: 12,
            overflowY: 'auto',
          }}
        >
          {/* Cor da caneta */}
          <button
            ref={penButtonRef}
            onClick={handleColorButtonClick}
            className="p-2.5 rounded-xl bg-gray-700 hover:bg-gray-600 shadow-lg transition-all shrink-0"
            title="Cor da caneta"
          >
            <div className="w-5 h-5 rounded-full border-2 border-white" style={{ backgroundColor: lineColor }} />
          </button>

          <button onClick={undoLastLine} className="p-2.5 rounded-xl text-gray-400 hover:bg-gray-800 shrink-0" title="Desfazer">
            <Undo size={20} />
          </button>
          <button onClick={clearLines} className="p-2.5 rounded-xl text-gray-400 hover:text-red-500 shrink-0" title="Limpar">
            <Eraser size={20} />
          </button>

          {/* Tipo de quadra */}
          <div className={`flex gap-1 items-center shrink-0 ${isPortrait ? 'flex-row' : 'flex-col w-full px-2'}`}>
            <button
              onClick={() => setCourtType('half')}
              className={`text-[9px] font-bold py-1 px-2 rounded transition-all ${courtType === 'half' ? 'bg-[#F27405] text-white' : 'bg-gray-700 text-gray-300'}`}
            >1/2</button>
            <button
              onClick={() => setCourtType('full')}
              className={`text-[9px] font-bold py-1 px-2 rounded transition-all ${courtType === 'full' ? 'bg-[#F27405] text-white' : 'bg-gray-700 text-gray-300'}`}
            >Full</button>
          </div>

          <div className={isPortrait ? 'w-px h-8 bg-gray-700 mx-1 shrink-0' : 'h-px w-10 bg-gray-700 shrink-0'} />

          {/* Timeline — scroll horizontal em portrait, vertical em landscape */}
          <div
            className="flex gap-2 items-center"
            style={isPortrait
              ? { flexDirection: 'row', overflowX: 'auto', maxWidth: 200 }
              : { flexDirection: 'column', overflowY: 'auto', maxHeight: '40vh', width: '100%', padding: '0 8px' }
            }
          >
            {frames.map((frame, index) => (
              <button
                key={index}
                onClick={() => changeFrame(index)}
                className={`relative rounded-lg font-bold text-xs flex flex-col items-center justify-center transition-all border-2 shrink-0
                  ${index === currentFrameIndex
                    ? 'bg-[#F27405] border-[#F27405] text-white shadow-lg'
                    : 'bg-white/10 border-transparent text-gray-300 hover:bg-white/20'
                  }`}
                style={{ width: 40, height: 40 }}
              >
                <span>{index + 1}</span>
                <span className="text-[7px] opacity-70">{frame.courtType === 'half' ? '1/2' : 'Full'}</span>
                {frame.lines.length > 0 && (
                  <div className="absolute bottom-0.5 w-1 h-1 bg-white rounded-full opacity-50" />
                )}
              </button>
            ))}
          </div>

          <button
            onClick={addNewFrame}
            className="bg-blue-600 hover:bg-blue-500 p-2.5 rounded-full text-white shadow-md transition-transform active:scale-95 shrink-0"
            title="Novo Frame"
          >
            <Plus size={20} />
          </button>

          {frames.length > 1 && (
            <button
              onClick={deleteFrame}
              className="text-red-400 hover:text-red-300 hover:bg-white/10 p-1.5 rounded-lg transition-colors shrink-0"
              title="Apagar frame"
            >
              <Trash2 size={17} />
            </button>
          )}
        </div>
      </main>

      {/* COLOR PICKER */}
      {showColorPicker && (
        <div
          className="fixed flex flex-col gap-2 bg-gray-800 p-3 rounded-2xl shadow-2xl border border-gray-600"
          style={{ top: colorPickerPos.top, right: colorPickerPos.right, zIndex: 9999 }}
          onMouseDown={e => e.stopPropagation()}
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
          <div className="bg-gray-800 rounded-xl p-6 w-full max-w-sm shadow-2xl border border-gray-700">
            <h3 className="text-xl font-bold mb-4 text-white flex items-center gap-2">
              <Save size={20} className="text-green-500" /> Salvar Jogada
            </h3>
            <input
              autoFocus type="text" placeholder="Nome da jogada"
              className="w-full p-3 rounded-lg bg-gray-700 border border-gray-600 text-white mb-4 outline-none focus:ring-2 focus:ring-[#F27405]"
              value={playName} onChange={e => setPlayName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && savePlay()}
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowSaveModal(false)} className="px-4 py-2 text-gray-400 hover:text-gray-200">Cancelar</button>
              <button onClick={savePlay} className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-bold">Salvar</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL CARREGAR */}
      {showLoadModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center backdrop-blur-sm p-4">
          <div className="bg-gray-800 rounded-xl w-full max-w-md shadow-2xl border border-gray-700 flex flex-col" style={{ maxHeight: '80vh' }}>
            <div className="p-4 border-b border-gray-700 flex justify-between items-center">
              <h3 className="text-xl font-bold text-white flex items-center gap-2">
                <FolderOpen size={20} className="text-[#F27405]" /> Minhas Jogadas
              </h3>
              <button onClick={() => setShowLoadModal(false)} className="text-gray-400 hover:text-white"><X size={24} /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {savedPlays.length === 0
                ? <p className="text-center py-8 text-gray-500">Nenhuma jogada salva.</p>
                : (
                  <div className="space-y-2">
                    {savedPlays.map(play => (
                      <div
                        key={play.id} onClick={() => loadPlay(play)}
                        className="bg-gray-700/50 hover:bg-gray-700 p-3 rounded-lg cursor-pointer border border-transparent hover:border-[#F27405] transition-all group flex justify-between items-center text-white"
                      >
                        <div>
                          <p className="font-bold">{play.name}</p>
                          <p className="text-xs text-gray-400">{play.frames.length} frame{play.frames.length > 1 ? 's' : ''}</p>
                        </div>
                        <button
                          onClick={e => deleteSavedPlay(play.id, e)}
                          className="p-2 text-gray-500 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    ))}
                  </div>
                )
              }
            </div>
          </div>
        </div>
      )}

      {/* MENU JOGADORES — não fecha ao adicionar */}
      {showMenu && (
        <>
          <div className="fixed inset-0 bg-black/50 z-40" onClick={() => setShowMenu(false)} />
          <div
            className="fixed top-0 right-0 h-full bg-gray-900 shadow-2xl z-50 flex flex-col border-l border-gray-700"
            style={{ width: 280 }}
          >
            <div className="p-4 border-b border-gray-800 flex justify-between items-center bg-[#062553]">
              <h2 className="font-bold text-white text-base flex items-center gap-2">
                <UserPlus size={18} className="text-[#F27405]" /> Elenco ANCB
              </h2>
              <button onClick={() => setShowMenu(false)} className="text-gray-300 hover:text-white"><X size={22} /></button>
            </div>
            <p className="text-xs text-gray-400 px-4 pt-3 pb-1">Toque para adicionar. Feche quando terminar.</p>
            <div className="flex-1 overflow-y-auto p-3">
              <div className="grid gap-1">
                {dbPlayers.map(player => {
                  const onCourt = tokens.some(t => t.type === 'ancb' && t.nome === player.nome);
                  return (
                    <button
                      key={player.id}
                      onClick={() => addPlayerToCourt(player)}
                      disabled={onCourt}
                      className={`flex items-center gap-3 p-2 rounded-lg transition-colors text-left w-full ${onCourt ? 'opacity-40' : 'hover:bg-gray-800'}`}
                    >
                      <div className="w-9 h-9 rounded-full overflow-hidden border-2 border-[#062553] bg-gray-700 shrink-0">
                        <img
                          src={player.foto || `${ASSETS_URLS.defaultAvatar}${player.nome}`}
                          alt={player.nome} className="w-full h-full object-cover"
                        />
                      </div>
                      <div>
                        <p className="font-bold text-sm text-white">{player.nome}</p>
                        {onCourt && <p className="text-[10px] text-green-400">✓ Na quadra</p>}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default App;
