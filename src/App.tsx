import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Stage, Layer, Image as KonvaImage, Group, Circle, Text, Rect, Line } from 'react-konva';
import { UserPlus, X, Trash2, Undo, Eraser, Save, FolderOpen, Plus, Play, Pause, Share2, MoreVertical } from 'lucide-react';
import GIF from 'gif.js';
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
  type: 'ancb' | 'rival' | 'generic' | 'ball';
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

interface GifExportState {
  isGenerating: boolean;
  progress: number;
  playId: string | null;
}

interface PlayMenuPosition {
  top: number;
  left: number;
}

const ASSETS_URLS = {
  courtHalf: 'https://i.imgur.com/SIdCxjw.png',
  courtFull: 'https://i.imgur.com/cw3dO3o.png',
  logo: 'https://i.imgur.com/sfO9ILj.png',
  defaultAvatar: 'https://ui-avatars.com/api/?background=0D8ABC&color=fff&rounded=true&bold=true&name='
};

const PEN_COLORS = ['#ff0000', '#000000', '#ffffff', '#ffff00', '#00ff00'];
const SAFE_AREA_TOP = 'env(safe-area-inset-top, 0px)';
const SAFE_AREA_BOTTOM = 'env(safe-area-inset-bottom, 0px)';
const SAFE_AREA_BOTTOM_WITH_MIN = 'max(env(safe-area-inset-bottom, 0px), 12px)';
const SAFE_AREA_LEFT = 'env(safe-area-inset-left, 0px)';
const SAFE_AREA_RIGHT = 'env(safe-area-inset-right, 0px)';
const GIF_CONFIG = {
  FPS: 12,
  TRANSITION_MS: 900,
  HOLD_MS: 600,
  LAST_HOLD_MS: 2000,
  CANVAS_WIDTH: 800,
  CANVAS_HEIGHT: 450,
  QUALITY: 10,
} as const;

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
  const ball: Token = {
    id: 'ball-1', type: 'ball' as const,
    xRatio: SIDEBAR_X, yRatio: 0.94,
  };
  return [...rivals, ...generics, ball];
};

// ============================================================================
// COMPONENTE TOKEN
// ============================================================================

interface PlayerTokenProps {
  token: Token;
  canvasW: number;
  canvasH: number;
  isPortrait: boolean;
  onDragEnd: (id: string, xRatio: number, yRatio: number) => void;
  onSelect: (id: string) => void;
  isSelected: boolean;
}

const PlayerToken: React.FC<PlayerTokenProps> = ({ token, canvasW, canvasH, isPortrait, onDragEnd, onSelect, isSelected }) => {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading');

  useEffect(() => {
    if (token.type === 'ball') {
      const img = new window.Image();
      img.crossOrigin = 'Anonymous';
      img.src = 'https://i.imgur.com/r5lIlfO.png';
      img.onload = () => { setImage(img); setStatus('loaded'); };
      img.onerror = () => setStatus('error');
      return;
    }
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
  const isBall = token.type === 'ball';
  const isOpponent = token.type === 'rival';
  const isGeneric = token.type === 'generic';
  const mainColor = isOpponent ? '#ef4444' : isGeneric ? '#1e3a5f' : '#062553';
  const strokeColor = isOpponent ? '#991b1b' : isGeneric ? '#0f1f33' : '#041b3d';
  const showText = isOpponent || isGeneric || status !== 'loaded';

  // Ball token is smaller
  const tokenRadius = isBall ? 14 : radius;

  if (isBall) {
    const size = tokenRadius * 2;
    return (
      <Group
        draggable={!isPortrait}
        x={px} y={py}
        onDragEnd={e => onDragEnd(token.id, e.target.x() / canvasW, e.target.y() / canvasH)}
        onClick={e => { e.cancelBubble = true; onSelect(token.id); }}
        onTap={e => { e.cancelBubble = true; onSelect(token.id); }}
      >
        {image && (
          <KonvaImage
            image={image}
            width={size} height={size}
            x={-tokenRadius} y={-tokenRadius}
            listening={false}
          />
        )}
        <Circle
          radius={tokenRadius}
          fill="transparent"
          stroke={isSelected ? '#F27405' : '#041b3d'}
          strokeWidth={isSelected ? 4 : 3}
        />
      </Group>
    );
  }

  return (
    <Group
      draggable={!isPortrait}
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
  const stageContainerRef = useRef<HTMLDivElement>(null);

  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [viewportHeight, setViewportHeight] = useState(() => window.innerHeight);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
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
  const [isPlaying, setIsPlaying] = useState(false);
  const [displayTokens, setDisplayTokens] = useState<Token[]>(buildDefaultTokens());
  const [isTokenAnimating, setIsTokenAnimating] = useState(false);
  const displayTokensRef = useRef<Token[]>(buildDefaultTokens());
  const tokenAnimationFrameRef = useRef<number | null>(null);
  const FRAME_DELAY_MS = 1300;
  const TOKEN_ANIM_MS = 900;

  const currentFrame = frames[currentFrameIndex];
  const tokens = currentFrame.tokens;
  const lines = currentFrame.lines;
  const courtType = currentFrame.courtType;

  // Layout adapts to orientation — toolbar goes bottom in portrait, right in landscape
  const isPortrait = dimensions.height > dimensions.width;

  useEffect(() => {
    displayTokensRef.current = displayTokens;
  }, [displayTokens]);

  const [lineColor, setLineColor] = useState('#ff0000');
  const [isDrawing, setIsDrawing] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [colorPickerPos, setColorPickerPos] = useState({ top: 0, right: 0 });
  const touchStartRef = useRef<{ tokenId: string | null } | null>(null);
  const draggingTokenIdRef = useRef<string | null>(null);
  const isActuallyDrawingRef = useRef(false);

  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showLoadModal, setShowLoadModal] = useState(false);
  const [playName, setPlayName] = useState('');
  const [savedPlays, setSavedPlays] = useState<SavedPlay[]>([]);
  const [openPlayMenuId, setOpenPlayMenuId] = useState<string | null>(null);
  const [openPlayMenuPos, setOpenPlayMenuPos] = useState<PlayMenuPosition | null>(null);
  const [gifExport, setGifExport] = useState<GifExportState>({
    isGenerating: false,
    progress: 0,
    playId: null,
  });

  useEffect(() => {
    if (!showLoadModal) {
      setOpenPlayMenuId(null);
      setOpenPlayMenuPos(null);
    }
  }, [showLoadModal]);

  // Buscar jogadores e jogadas salvas
  useEffect(() => {
    const fetchPlayers = async () => {
      try {
        const snap = await getDocs(collection(db, "jogadores"));
        const raw = snap.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Partial<Player>[];
        const list: Player[] = raw.filter((player): player is Player => (
          typeof player.id === 'string'
          && typeof player.nome === 'string'
          && player.nome.trim().length > 0
        ));
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
      const target = stageContainerRef.current ?? containerRef.current;
      if (!target) return;

      const rect = target.getBoundingClientRect();
      const nextWidth = Math.round(rect.width);
      const nextHeight = Math.round(rect.height);

      setDimensions(prev => {
        if (prev.width === nextWidth && prev.height === nextHeight) return prev;
        return { width: nextWidth, height: nextHeight };
      });
    };

    const handleOrientationChange = () => setTimeout(updateSize, 200);

    let raf1 = 0;
    let raf2 = 0;
    const resizeObserver = new ResizeObserver(() => updateSize());

    updateSize();
    // Duas leituras em frames seguintes para evitar tamanho inicial incompleto no mobile.
    raf1 = window.requestAnimationFrame(() => {
      updateSize();
      raf2 = window.requestAnimationFrame(updateSize);
    });

    if (stageContainerRef.current) {
      resizeObserver.observe(stageContainerRef.current);
    }

    window.addEventListener('resize', updateSize);
    window.addEventListener('orientationchange', handleOrientationChange);
    return () => {
      if (raf1) window.cancelAnimationFrame(raf1);
      if (raf2) window.cancelAnimationFrame(raf2);
      resizeObserver.disconnect();
      window.removeEventListener('resize', updateSize);
      window.removeEventListener('orientationchange', handleOrientationChange);
    };
  }, [viewportWidth, viewportHeight]);

  // Usa a altura real visivel para evitar corte do HUD no iPhone (toolbar dinamica do Safari).
  useEffect(() => {
    const updateViewportHeight = () => {
      const visibleHeight = window.visualViewport?.height ?? window.innerHeight;
      const visibleWidth = window.visualViewport?.width ?? window.innerWidth;
      setViewportHeight(Math.round(visibleHeight));
      setViewportWidth(Math.round(visibleWidth));
    };

    updateViewportHeight();
    window.addEventListener('resize', updateViewportHeight);
    window.addEventListener('orientationchange', updateViewportHeight);
    window.visualViewport?.addEventListener('resize', updateViewportHeight);
    window.visualViewport?.addEventListener('scroll', updateViewportHeight);

    return () => {
      window.removeEventListener('resize', updateViewportHeight);
      window.removeEventListener('orientationchange', updateViewportHeight);
      window.visualViewport?.removeEventListener('resize', updateViewportHeight);
      window.visualViewport?.removeEventListener('scroll', updateViewportHeight);
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

  const cancelTokenAnimation = useCallback(() => {
    if (tokenAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(tokenAnimationFrameRef.current);
      tokenAnimationFrameRef.current = null;
    }
  }, []);

  const animateTokensToFrame = useCallback((targetFrameIndex: number) => {
    if (targetFrameIndex < 0 || targetFrameIndex >= frames.length) return;
    if (targetFrameIndex === currentFrameIndex) return;

    cancelTokenAnimation();

    const fromTokens = displayTokensRef.current;
    const toTokens = frames[targetFrameIndex].tokens;
    const fromById = new Map(fromTokens.map(token => [token.id, token]));

    setCurrentFrameIndex(targetFrameIndex);
    setSelectedTokenId(null);
    setIsTokenAnimating(true);

    const start = performance.now();
    const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / TOKEN_ANIM_MS);
      const eased = easeInOut(progress);

      const animated = toTokens.map(token => {
        const from = fromById.get(token.id) || token;
        return {
          ...token,
          xRatio: from.xRatio + (token.xRatio - from.xRatio) * eased,
          yRatio: from.yRatio + (token.yRatio - from.yRatio) * eased,
        };
      });

      setDisplayTokens(animated);

      if (progress < 1) {
        tokenAnimationFrameRef.current = window.requestAnimationFrame(step);
        return;
      }

      tokenAnimationFrameRef.current = null;
      setDisplayTokens(toTokens);
      setIsTokenAnimating(false);
    };

    tokenAnimationFrameRef.current = window.requestAnimationFrame(step);
  }, [cancelTokenAnimation, currentFrameIndex, frames, TOKEN_ANIM_MS]);

  const pausePlayback = useCallback(() => {
    setIsPlaying(false);
  }, []);

  const playPlayback = useCallback(() => {
    if (frames.length <= 1) return;

    if (currentFrameIndex >= frames.length - 1) {
      animateTokensToFrame(0);
    }

    setIsPlaying(true);
  }, [animateTokensToFrame, currentFrameIndex, frames.length]);

  const togglePlayback = useCallback(() => {
    if (isPlaying) {
      pausePlayback();
      return;
    }
    playPlayback();
  }, [isPlaying, pausePlayback, playPlayback]);

  const changeFrame = (index: number) => {
    if (index >= 0 && index < frames.length) {
      animateTokensToFrame(index);
    }
  };

  useEffect(() => {
    if (isTokenAnimating) return;
    setDisplayTokens(tokens);
  }, [tokens, isTokenAnimating]);

  useEffect(() => {
    if (!isPlaying) return;

    if (currentFrameIndex >= frames.length - 1) {
      setIsPlaying(false);
      return;
    }

    const timer = window.setTimeout(() => {
      animateTokensToFrame(currentFrameIndex + 1);
    }, FRAME_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [isPlaying, currentFrameIndex, frames.length, animateTokensToFrame, FRAME_DELAY_MS]);

  useEffect(() => {
    return () => cancelTokenAnimation();
  }, [cancelTokenAnimation]);

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
    setIsPlaying(false);
    setSelectedTokenId(null);
  };

  const deleteFrame = () => {
    if (frames.length <= 1) return;
    if (!confirm("Deseja apagar este frame?")) return;
    setIsPlaying(false);
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
    } else if (selectedTokenId === 'ball-1') {
      updateCurrentFrame({ tokens: tokens.map(t => t.id === 'ball-1' ? { ...t, xRatio: SIDEBAR_X, yRatio: 0.94 } : t) });
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

  // Converte coordenadas para o espaço lógico do Stage quando ele está rotacionado no portrait.
  const getStagePos = (e: any): {x: number, y: number} | null => {
    const stage = e.target.getStage?.() ?? e.target;
    if (!stage) return null;

    if (!isPortrait) {
      return stage.getPointerPosition();
    }

    const nativeEvent = e.evt as TouchEvent & MouseEvent;
    const clientX = nativeEvent.touches?.[0]?.clientX ?? nativeEvent.clientX;
    const clientY = nativeEvent.touches?.[0]?.clientY ?? nativeEvent.clientY;
    const stageEl = stage.container?.();
    if (!stageEl) return null;
    const rect = stageEl.getBoundingClientRect();

    const screenX = clientX - rect.left;
    const screenY = clientY - rect.top;

    // Para rotate(90deg) translateY(-100%):
    // logicalX = visualY, logicalY = rect.width - visualX
    return { x: screenY, y: rect.width - screenX };
  };

  const handlePointerDown = (e: any) => {
    const pos = getStagePos(e);
    if (!pos) return;
    const tokenId = getTokenAtPosition(pos.x, pos.y);
    touchStartRef.current = { tokenId };
    isActuallyDrawingRef.current = false;
    if (tokenId) {
      draggingTokenIdRef.current = tokenId;
      setSelectedTokenId(tokenId);
      return;
    }

    isActuallyDrawingRef.current = true;
    setIsDrawing(true);
    const newLine: DrawnLine = {
      tool: 'pen', color: lineColor,
      pointRatios: [pos.x / stageW, pos.y / stageH]
    };
    updateCurrentFrame({ lines: [...lines, newLine] });
  };

  const handlePointerMove = (e: any) => {
    const draggingTokenId = draggingTokenIdRef.current;
    if (draggingTokenId) {
      const pos = getStagePos(e);
      if (!pos) return;
      handleDragEnd(draggingTokenId, pos.x / stageW, pos.y / stageH);
      return;
    }

    if (!isActuallyDrawingRef.current || !isDrawing) return;
    const pos = getStagePos(e);
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
    draggingTokenIdRef.current = null;
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
    setIsPlaying(false);
    setShowLoadModal(false);
  };

  const newPlay = () => {
    const hasContent = frames.length > 1 || frames[0].lines.length > 0 ||
      frames[0].tokens.some(t => t.type === 'ancb');

    if (hasContent) {
      const action = window.confirm("Deseja salvar a jogada atual antes de começar uma nova?");
      if (action) {
        const name = window.prompt("Nome da jogada:");
        if (name?.trim()) {
          const play: SavedPlay = {
            id: Date.now().toString(), name: name.trim(),
            frames, createdAt: Date.now()
          };
          const updated = [play, ...savedPlays];
          setSavedPlays(updated);
          localStorage.setItem('ancb_plays', JSON.stringify(updated));
        }
      }
    }

    // Reset to blank
    const blank: Frame[] = [{ courtType: 'half', tokens: buildDefaultTokens(), lines: [] }];
    setFrames(blank);
    setCurrentFrameIndex(0);
    setIsPlaying(false);
    setSelectedTokenId(null);
  };

  const deleteSavedPlay = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (confirm("Apagar jogada?")) {
      const updated = savedPlays.filter(p => p.id !== id);
      setSavedPlays(updated);
      localStorage.setItem('ancb_plays', JSON.stringify(updated));
      setOpenPlayMenuId(null);
      setOpenPlayMenuPos(null);
    }
  };

  const closePlayMenu = () => {
    setOpenPlayMenuId(null);
    setOpenPlayMenuPos(null);
  };

  const openPlayActionsMenu = (playId: string, button: HTMLButtonElement) => {
    const isSameOpen = openPlayMenuId === playId;
    if (isSameOpen) {
      closePlayMenu();
      return;
    }

    const rect = button.getBoundingClientRect();
    const MENU_WIDTH = 176; // Tailwind w-44
    const MENU_HEIGHT = 96;
    const GAP = 8;
    const PAD = 8;

    const left = Math.max(
      PAD,
      Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - PAD)
    );

    let top = rect.bottom + GAP;
    if (top + MENU_HEIGHT > window.innerHeight - PAD) {
      top = Math.max(PAD, rect.top - MENU_HEIGHT - GAP);
    }

    setOpenPlayMenuId(playId);
    setOpenPlayMenuPos({ top, left });
  };

  const generateAndShareGif = useCallback(async (play: SavedPlay) => {
    setGifExport({ isGenerating: true, progress: 0, playId: play.id });

    try {
      const W = GIF_CONFIG.CANVAS_WIDTH;
      const H = GIF_CONFIG.CANVAS_HEIGHT;
      const MS_PER_FRAME = 1000 / GIF_CONFIG.FPS;
      const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

      const loadImage = (src: string): Promise<HTMLImageElement> =>
        new Promise((resolve, reject) => {
          const img = new window.Image();
          img.crossOrigin = 'Anonymous';
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = src.startsWith('data:') ? src : `${src}${src.includes('?') ? '&' : '?'}cb=${Date.now()}`;
        });

      const photoSrcs = new Set<string>();
      play.frames.forEach(frame => frame.tokens.forEach(token => {
        if (token.type === 'ancb') {
          photoSrcs.add(token.foto || `${ASSETS_URLS.defaultAvatar}${token.nome}`);
        }
      }));

      const ballSrc = 'https://i.imgur.com/r5lIlfO.png';
      photoSrcs.add(ballSrc);

      const imageCache = new Map<string, HTMLImageElement>();
      await Promise.allSettled(
        [...photoSrcs].map(src => loadImage(src).then(img => imageCache.set(src, img)).catch(() => undefined))
      );

      const firstCourtType = play.frames[0]?.courtType ?? 'half';
      const [courtImg, logoImg] = await Promise.all([
        loadImage(firstCourtType === 'half' ? ASSETS_URLS.courtHalf : ASSETS_URLS.courtFull),
        loadImage(ASSETS_URLS.logo),
      ]);
      const courtCache = new Map<'half' | 'full', HTMLImageElement>();
      courtCache.set(firstCourtType, courtImg);

      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('Falha ao inicializar canvas 2D');

      const downloadGifBlob = (blob: Blob, fileName: string) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      };

      const renderSnapshot = async (
        frameTokens: Token[],
        frameLines: DrawnLine[],
        snapshotCourtType: 'half' | 'full'
      ) => {
        ctx.clearRect(0, 0, W, H);

        ctx.fillStyle = '#1e3a5f';
        ctx.fillRect(0, 0, W, H);

        if (!courtCache.has(snapshotCourtType)) {
          try {
            const img = await loadImage(
              snapshotCourtType === 'half' ? ASSETS_URLS.courtHalf : ASSETS_URLS.courtFull
            );
            courtCache.set(snapshotCourtType, img);
          } catch (_) {
            // Ignore and continue rendering fallback background.
          }
        }

        const court = courtCache.get(snapshotCourtType);
        if (court) {
          const scale = Math.min((W * 0.99) / court.width, (H * 0.99) / court.height);
          const imgW = court.width * scale;
          const imgH = court.height * scale;
          const cx = (W - imgW) / 2;
          const cy = (H - imgH) / 2;

          const grad = ctx.createLinearGradient(cx, cy, cx + imgW, cy + imgH);
          grad.addColorStop(0, '#2574d1');
          grad.addColorStop(1, '#1c64b6');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.roundRect(cx, cy, imgW, imgH, 5);
          ctx.fill();

          if (logoImg) {
            const ls = (imgW * 0.22) / logoImg.width;
            const lw = logoImg.width * ls;
            const lh = logoImg.height * ls;
            const lx = cx + (imgW - lw) / 2;
            const ly = cy + (imgH - lh) / 2;
            ctx.globalAlpha = 0.3;
            ctx.drawImage(logoImg, lx, ly, lw, lh);
            ctx.globalAlpha = 1;
          }

          ctx.drawImage(court, cx, cy, imgW, imgH);

          frameLines.forEach(line => {
            if (line.pointRatios.length < 4) return;
            ctx.beginPath();
            ctx.strokeStyle = line.color;
            ctx.lineWidth = 4;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.globalAlpha = 0.9;
            ctx.moveTo(line.pointRatios[0] * W, line.pointRatios[1] * H);
            for (let i = 2; i < line.pointRatios.length; i += 2) {
              ctx.lineTo(line.pointRatios[i] * W, line.pointRatios[i + 1] * H);
            }
            ctx.stroke();
            ctx.globalAlpha = 1;
          });
        }

        for (const token of frameTokens) {
          const px = token.xRatio * W;
          const py = token.yRatio * H;
          const isBall = token.type === 'ball';
          const isOpponent = token.type === 'rival';
          const isGeneric = token.type === 'generic';
          const radius = isBall ? 14 : 22;
          const mainColor = isOpponent ? '#ef4444' : isGeneric ? '#1e3a5f' : '#062553';
          const strokeColor = isOpponent ? '#991b1b' : isGeneric ? '#0f1f33' : '#041b3d';

          ctx.save();
          ctx.translate(px, py);

          if (isBall) {
            const ballImg = imageCache.get(ballSrc);
            if (ballImg) {
              ctx.drawImage(ballImg, -radius, -radius, radius * 2, radius * 2);
            } else {
              ctx.beginPath();
              ctx.arc(0, 0, radius, 0, Math.PI * 2);
              ctx.fillStyle = '#f97316';
              ctx.fill();
            }
            ctx.beginPath();
            ctx.arc(0, 0, radius, 0, Math.PI * 2);
            ctx.strokeStyle = strokeColor;
            ctx.lineWidth = 3;
            ctx.stroke();
          } else {
            ctx.beginPath();
            ctx.arc(2, 2, radius, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(0,0,0,0.3)';
            ctx.fill();

            ctx.beginPath();
            ctx.arc(0, 0, radius, 0, Math.PI * 2);
            ctx.fillStyle = mainColor;
            ctx.fill();

            if (token.type === 'ancb') {
              const src = token.foto || `${ASSETS_URLS.defaultAvatar}${token.nome}`;
              const img = imageCache.get(src);
              if (img) {
                ctx.save();
                ctx.beginPath();
                ctx.arc(0, 0, radius, 0, Math.PI * 2);
                ctx.clip();
                ctx.drawImage(img, -radius, -radius, radius * 2, radius * 2);
                ctx.restore();
              }
            }

            ctx.beginPath();
            ctx.arc(0, 0, radius, 0, Math.PI * 2);
            ctx.strokeStyle = strokeColor;
            ctx.lineWidth = 2;
            ctx.stroke();

            if (token.type !== 'ancb' || !imageCache.has(token.foto || `${ASSETS_URLS.defaultAvatar}${token.nome}`)) {
              ctx.fillStyle = 'white';
              ctx.font = 'bold 20px sans-serif';
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              const label = (isOpponent || isGeneric)
                ? token.numero?.toString() ?? ''
                : token.nome?.charAt(0).toUpperCase() ?? '';
              ctx.fillText(label, 0, 0);
            }

            if (token.type === 'ancb' && token.nome) {
              ctx.fillStyle = 'white';
              ctx.font = '10px sans-serif';
              ctx.textAlign = 'center';
              ctx.textBaseline = 'top';
              ctx.shadowColor = 'black';
              ctx.shadowBlur = 3;
              ctx.fillText(token.nome.split(' ')[0], 0, radius + 5);
              ctx.shadowBlur = 0;
            }
          }

          ctx.restore();
        }
      };

      const gif = new GIF({
        workers: 2,
        quality: GIF_CONFIG.QUALITY,
        width: W,
        height: H,
        workerScript: '/gif.worker.js',
        repeat: 0,
      });

      const totalFrames = play.frames.length;
      let capturedFrameCount = 0;

      const transitionFrames = Math.round(GIF_CONFIG.TRANSITION_MS / MS_PER_FRAME);
      const totalSnapshots = Math.max(
        1,
        totalFrames + Math.max(0, totalFrames - 1) * transitionFrames
      );

      const addProgress = () => {
        capturedFrameCount++;
        setGifExport(prev => ({
          ...prev,
          progress: Math.round((capturedFrameCount / totalSnapshots) * 85),
        }));
      };

      for (let fi = 0; fi < totalFrames; fi++) {
        const frame = play.frames[fi];
        const isLastFrame = fi === totalFrames - 1;
        const holdDelayMs = isLastFrame
          ? Math.max(GIF_CONFIG.LAST_HOLD_MS, MS_PER_FRAME)
          : Math.max(GIF_CONFIG.HOLD_MS, MS_PER_FRAME);

        // Compacta o HOLD em um unico frame com delay maior, evitando frames duplicados.
        await renderSnapshot(frame.tokens, frame.lines, frame.courtType);
        gif.addFrame(canvas, { copy: true, delay: holdDelayMs });
        addProgress();
        await new Promise(resolve => setTimeout(resolve, 0));

        if (fi < totalFrames - 1) {
          const nextFrame = play.frames[fi + 1];
          const fromById = new Map(frame.tokens.map(token => [token.id, token]));

          for (let t = 0; t < transitionFrames; t++) {
            const progress = t / transitionFrames;
            const eased = easeInOut(progress);

            const interpolated: Token[] = nextFrame.tokens.map(token => {
              const from = fromById.get(token.id) || token;
              return {
                ...token,
                xRatio: from.xRatio + (token.xRatio - from.xRatio) * eased,
                yRatio: from.yRatio + (token.yRatio - from.yRatio) * eased,
              };
            });

            await renderSnapshot(interpolated, frame.lines, frame.courtType);
            gif.addFrame(canvas, { copy: true, delay: MS_PER_FRAME });
            addProgress();
            if (t % 4 === 0) await new Promise(resolve => setTimeout(resolve, 0));
          }
        }
      }

      const gifBlob: Blob = await new Promise((resolve, reject) => {
        gif.on('progress', (progress: number) => {
          setGifExport(prev => ({ ...prev, progress: 85 + Math.round(progress * 15) }));
        });
        gif.on('finished', (blob: Blob) => resolve(blob));
        // The runtime emits "error", but @types/gif.js does not declare this event.
        (gif as unknown as { on: (event: 'error', listener: (reason: unknown) => void) => void })
          .on('error', reject);
        gif.render();
      });

      const fileName = `${play.name.replace(/[^a-z0-9]/gi, '_')}_jogada.gif`;
      const gifFile = new File([gifBlob], fileName, { type: 'image/gif' });
      const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(window.navigator.userAgent);

      // Em navegadores desktop, faz download direto para evitar falha de gesto do Web Share API.
      if (!isMobile) {
        downloadGifBlob(gifBlob, fileName);
        return;
      }

      try {
        if (navigator.canShare && navigator.canShare({ files: [gifFile] })) {
          await navigator.share({
            files: [gifFile],
            title: `Jogada: ${play.name}`,
            text: 'Confira essa jogada da ANCB!',
          });
          return;
        }

        if (navigator.share) {
          const url = URL.createObjectURL(gifBlob);
          await navigator.share({ title: `Jogada: ${play.name}`, url });
          setTimeout(() => URL.revokeObjectURL(url), 60000);
          return;
        }
      } catch (_) {
        // Se share falhar (ex.: perdeu user gesture), cai para download.
      }

      downloadGifBlob(gifBlob, fileName);
    } catch (err) {
      console.error('Erro ao gerar GIF:', err);
      alert('Nao foi possivel gerar o GIF. Tente novamente.');
    } finally {
      setGifExport({ isGenerating: false, progress: 0, playId: null });
    }
  }, []);

  // ============================================================================
  // CÁLCULO DA QUADRA
  // Em portrait, o Stage é renderizado em landscape (dimensões invertidas)
  // e girado via CSS para preencher toda a área útil sem folgas.
  // ============================================================================

  const stageW = isPortrait ? dimensions.height : dimensions.width;
  const stageH = isPortrait ? dimensions.width : dimensions.height;

  let imgWidth = 0, imgHeight = 0, courtX = 0, courtY = 0;
  let logoConfig = { w: 0, h: 0, x: 0, y: 0 };
  let linesWidth = 0, linesHeight = 0, linesX = 0, linesY = 0;

  if (assets.lines && stageW > 0) {
    const scale = Math.min(
      (stageW * 0.99) / assets.lines.width,
      (stageH * 0.99) / assets.lines.height
    );
    imgWidth = assets.lines.width * scale;
    imgHeight = assets.lines.height * scale;
    courtX = (stageW - imgWidth) / 2;
    courtY = (stageH - imgHeight) / 2;

    // Em mobile portrait com quadra cheia, reduz apenas o PNG das linhas
    // mantendo o retângulo azul no mesmo tamanho.
    const lineFitFactor = isPortrait && courtType === 'full' ? 0.90 : 1;
    linesWidth = imgWidth * lineFitFactor;
    linesHeight = imgHeight * lineFitFactor;
    linesX = courtX + (imgWidth - linesWidth) / 2;
    linesY = courtY + (imgHeight - linesHeight) / 2;

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

  const activePlayMenuItem = openPlayMenuId
    ? (savedPlays.find(play => play.id === openPlayMenuId) ?? null)
    : null;

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
        width: `${viewportWidth}px`,
        height: `${viewportHeight}px`,
        overflow: 'hidden',
        // Força layout landscape mesmo se o SO girar
        maxWidth: `${viewportWidth}px`,
        maxHeight: `${viewportHeight}px`,
        paddingLeft: SAFE_AREA_LEFT,
        paddingRight: SAFE_AREA_RIGHT,
      }}
    >
      {/* HEADER */}
      <header
        className="px-3 py-2 flex justify-between items-center bg-[#062553] border-b-4 border-[#041b3d] shadow-lg shrink-0 z-20"
        style={{
          height: `calc(56px + ${SAFE_AREA_TOP})`,
          paddingTop: SAFE_AREA_TOP,
        }}
      >
        <div className="flex items-center gap-2">
          <img src={ASSETS_URLS.logo} alt="Logo" className="w-9 h-9 object-contain drop-shadow-md" />
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={newPlay}
            className="bg-slate-600 hover:bg-slate-500 px-2.5 py-1.5 rounded-lg text-white font-bold text-xs flex items-center gap-1 transition-colors"
            title="Nova jogada"
          >
            <Plus size={15} /><span className="hidden sm:inline">Nova</span>
          </button>
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
        <div className="flex-1 relative overflow-hidden" ref={stageContainerRef} style={{ touchAction: 'none' }}>
          {dimensions.width > 0 && (
            <Stage
              width={stageW} height={stageH}
              onMouseDown={handlePointerDown} onMousemove={handlePointerMove} onMouseup={handlePointerUp}
              onTouchStart={handlePointerDown} onTouchMove={handlePointerMove} onTouchEnd={handlePointerUp}
              style={{
                cursor: 'crosshair',
                touchAction: 'none',
                display: 'block',
                ...(isPortrait ? {
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  transformOrigin: 'top left',
                  transform: 'rotate(90deg) translateY(-100%)',
                } : {}),
              }}
              onClick={e => { if (e.target === e.target.getStage()) setSelectedTokenId(null); }}
            >
              <Layer>
                <Rect
                  x={0} y={0} width={stageW} height={stageH}
                  fillLinearGradientStartPoint={{ x: 0, y: 0 }}
                  fillLinearGradientEndPoint={{ x: stageW, y: stageH }}
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
                    image={assets.lines} width={linesWidth} height={linesHeight}
                    x={linesX} y={linesY} listening={false}
                  />
                )}
                {renderLines.map((line, i) => (
                  <Line key={i} points={line.points} stroke={line.color} strokeWidth={4}
                    tension={0.5} lineCap="round" lineJoin="round" opacity={0.9} listening={false} />
                ))}
                {displayTokens.map(token => (
                  <PlayerToken
                    key={token.id} token={token}
                    canvasW={stageW} canvasH={stageH}
                    isPortrait={isPortrait}
                    onDragEnd={handleDragEnd} onSelect={setSelectedTokenId}
                    isSelected={selectedTokenId === token.id}
                  />
                ))}
              </Layer>
            </Stage>
          )}
        </div>

        {isPortrait && (
          <div
            className="absolute left-2 right-2 z-40 pointer-events-none"
            style={{ bottom: `calc(60px + ${SAFE_AREA_BOTTOM_WITH_MIN} + 8px)` }}
          >
            <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-2">
              <button
                onClick={togglePlayback}
                className={`p-2 rounded-xl text-white border shadow-md transition-colors shrink-0 ${isPlaying ? 'bg-amber-600 border-amber-300 hover:bg-amber-500' : 'bg-emerald-600 border-emerald-300 hover:bg-emerald-500'}`}
                title={isPlaying ? 'Pausar reprodução' : 'Reproduzir jogada'}
              >
                {isPlaying ? <Pause size={18} /> : <Play size={18} />}
              </button>

              {frames.map((frame, index) => (
                <button
                  key={index}
                  onClick={() => changeFrame(index)}
                  className={`relative rounded-lg font-bold text-xs flex flex-col items-center justify-center transition-all border-2 shrink-0
                    ${index === currentFrameIndex
                      ? 'bg-[#F27405] border-orange-200 text-white shadow-lg'
                      : 'bg-slate-800/95 border-slate-500 text-slate-100 hover:bg-slate-700/95'
                    }`}
                  style={{ width: 36, height: 36 }}
                >
                  <span>{index + 1}</span>
                  <span className="text-[7px] opacity-70">{frame.courtType === 'half' ? '1/2' : 'Full'}</span>
                  {frame.lines.length > 0 && (
                    <div className="absolute bottom-0.5 w-1 h-1 bg-white rounded-full opacity-50" />
                  )}
                </button>
              ))}

              <button
                onClick={addNewFrame}
                className="bg-blue-600 border border-blue-300 hover:bg-blue-500 p-2 rounded-full text-white shadow-md transition-transform active:scale-95 shrink-0"
                title="Novo Frame"
              >
                <Plus size={18} />
              </button>

              {frames.length > 1 && (
                <button
                  onClick={deleteFrame}
                  className="text-red-200 bg-red-950/70 border border-red-500 hover:bg-red-900/90 p-1.5 rounded-lg transition-colors shrink-0"
                  title="Apagar frame"
                >
                  <Trash2 size={16} />
                </button>
              )}
            </div>
          </div>
        )}

        {/* BARRA DE FERRAMENTAS — direita em landscape, baixo em portrait */}
        <div
          className="bg-slate-950 z-30 shrink-0 flex items-center gap-2"
          style={isPortrait ? {
            // Portrait: barra horizontal na base
            flexDirection: 'row',
            width: '100%',
            height: `calc(60px + ${SAFE_AREA_BOTTOM})`,
            borderTop: '1px solid #475569',
            paddingLeft: 8,
            paddingRight: 8,
            paddingBottom: SAFE_AREA_BOTTOM,
            overflowX: 'hidden',
            justifyContent: 'space-between',
          } : {
            // Landscape: barra vertical na direita
            flexDirection: 'column',
            width: 72,
            height: '100%',
            borderLeft: '1px solid #475569',
            paddingTop: 12,
            paddingBottom: 12,
            overflowY: 'auto',
          }}
        >
          {/* Cor da caneta */}
          <button
            ref={penButtonRef}
            onClick={handleColorButtonClick}
            className="p-2.5 rounded-xl bg-slate-700 hover:bg-slate-600 border border-slate-500 shadow-lg transition-all shrink-0"
            title="Cor da caneta"
          >
            <div className="w-5 h-5 rounded-full border-2 border-white" style={{ backgroundColor: lineColor }} />
          </button>

          <button onClick={undoLastLine} className="p-2.5 rounded-xl text-slate-200 hover:bg-slate-800 border border-transparent hover:border-slate-600 shrink-0" title="Desfazer">
            <Undo size={20} />
          </button>
          <button onClick={clearLines} className="p-2.5 rounded-xl text-slate-200 hover:text-red-300 hover:bg-slate-800 border border-transparent hover:border-slate-600 shrink-0" title="Limpar">
            <Eraser size={20} />
          </button>

          {/* Tipo de quadra */}
          <div className={`flex gap-1 items-center shrink-0 ${isPortrait ? 'flex-row' : 'flex-col w-full px-2'}`}>
            <button
              onClick={() => setCourtType('half')}
              className={`text-[9px] font-bold py-1 px-2 rounded border transition-all ${courtType === 'half' ? 'bg-[#F27405] border-orange-200 text-white' : 'bg-slate-700 border-slate-500 text-slate-100'}`}
            >1/2</button>
            <button
              onClick={() => setCourtType('full')}
              className={`text-[9px] font-bold py-1 px-2 rounded border transition-all ${courtType === 'full' ? 'bg-[#F27405] border-orange-200 text-white' : 'bg-slate-700 border-slate-500 text-slate-100'}`}
            >Full</button>
          </div>

          <div className={isPortrait ? 'w-px h-8 bg-slate-600 mx-1 shrink-0' : 'h-px w-10 bg-slate-600 shrink-0'} />

          {!isPortrait && (
            <button
              onClick={togglePlayback}
              className={`p-2.5 rounded-xl text-white shadow-md transition-colors shrink-0 ${isPlaying ? 'bg-amber-600 hover:bg-amber-500' : 'bg-emerald-600 hover:bg-emerald-500'}`}
              title={isPlaying ? 'Pausar reprodução' : 'Reproduzir jogada'}
            >
              {isPlaying ? <Pause size={20} /> : <Play size={20} />}
            </button>
          )}

          {!isPortrait && (
            <>
              {/* Timeline — vertical em landscape */}
              <div
                className="flex gap-2 items-center"
                style={{ flexDirection: 'column', overflowY: 'auto', maxHeight: '40vh', width: '100%', padding: '0 8px' }}
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
            </>
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
            <div className="relative flex-1 overflow-y-auto p-4" onClick={closePlayMenu} onScroll={closePlayMenu}>
              {savedPlays.length === 0
                ? <p className="text-center py-8 text-gray-500">Nenhuma jogada salva.</p>
                : (
                  <div className="space-y-2">
                    {savedPlays.map(play => {
                      return (
                      <div
                        key={play.id}
                        onClick={() => loadPlay(play)}
                        className="relative bg-gray-700/50 hover:bg-gray-700 p-3 rounded-lg cursor-pointer border border-transparent hover:border-[#F27405] transition-all group flex justify-between items-center text-white"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="font-bold truncate">{play.name}</p>
                          <p className="text-xs text-gray-400">{play.frames.length} frame{play.frames.length > 1 ? 's' : ''}</p>
                        </div>

                        <div className="shrink-0 ml-2 relative">
                          <button
                            onClick={e => {
                              e.stopPropagation();
                              openPlayActionsMenu(play.id, e.currentTarget);
                            }}
                            className="p-2 rounded-lg text-gray-300 hover:text-white hover:bg-gray-600 transition-colors opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                            title="Mais opcoes"
                          >
                            <MoreVertical size={18} />
                          </button>
                        </div>
                      </div>
                      );
                    })}
                  </div>
                )
              }
            </div>

            {openPlayMenuPos && activePlayMenuItem && createPortal(
              <div
                className="fixed w-44 bg-slate-900 border border-slate-700 rounded-lg shadow-2xl z-[120] overflow-hidden"
                style={{ top: openPlayMenuPos.top, left: openPlayMenuPos.left }}
                onClick={e => e.stopPropagation()}
              >
                <button
                  onClick={async e => {
                    e.stopPropagation();
                    closePlayMenu();
                    await generateAndShareGif(activePlayMenuItem);
                  }}
                  disabled={gifExport.isGenerating}
                  className={`w-full text-left px-3 py-2.5 text-sm flex items-center gap-2 transition-colors ${
                    gifExport.isGenerating
                      ? 'text-slate-500 cursor-not-allowed'
                      : 'text-white hover:bg-slate-800'
                  }`}
                >
                  <Share2 size={15} /> Compartilhar GIF
                </button>

                <button
                  onClick={e => {
                    e.stopPropagation();
                    deleteSavedPlay(activePlayMenuItem.id, e);
                  }}
                  className="w-full text-left px-3 py-2.5 text-sm flex items-center gap-2 text-red-400 hover:bg-slate-800 transition-colors"
                >
                  <Trash2 size={15} /> Excluir
                </button>
              </div>,
              document.body
            )}
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

      {gifExport.isGenerating && (
        <div className="fixed inset-0 bg-black/80 z-[100] flex flex-col items-center justify-center backdrop-blur-sm gap-6 p-8">
          <div className="relative w-20 h-20">
            <div
              className="w-20 h-20 rounded-full border-4 border-[#F27405] border-t-transparent animate-spin"
              style={{ animationDuration: '0.8s' }}
            />
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-2xl">🏀</span>
            </div>
          </div>

          <div className="text-center">
            <p className="text-white font-bold text-lg mb-1">Gerando GIF...</p>
            <p className="text-gray-400 text-sm">
              {gifExport.progress < 85
                ? `Renderizando frames... ${gifExport.progress}%`
                : `Codificando GIF... ${gifExport.progress}%`
              }
            </p>
          </div>

          <div className="w-full max-w-xs bg-gray-700 rounded-full h-3 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-[#F27405] to-orange-400 rounded-full transition-all duration-300"
              style={{ width: `${gifExport.progress}%` }}
            />
          </div>

          <p className="text-gray-500 text-xs text-center">
            Isso pode levar alguns segundos...
          </p>
        </div>
      )}
    </div>
  );
};

export default App;
