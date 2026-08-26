// ---------------------------------------------------------------------------
// Preview — the project's review room. A card grid occupying the whole page
// links to the four preview studios: VIDEO, AUDIO, SCRIPT, THUMBNAIL.
// Each card carries its live asset count and a hint of the media inside.
// ---------------------------------------------------------------------------

import { useMemo } from 'react';
import {
  ArrowLeft,
  AudioLines,
  Clapperboard,
  Film,
  Image as ImageIcon,
  Mic2,
  Sparkles,
  Type,
} from 'lucide-react';
import { Link, useParams } from 'wouter';
import { useGetVideoProject } from '@workspace/api-client-react';
import { SectionEyebrow } from '@/components/shell';
import { useProjectRealtime } from '@/lib/realtime';
import { proxyUrlFor } from '@/components/asset-preview';

const VIDEO_KINDS = new Set(['RAW_VIDEO', 'SCREEN_REC', 'B_ROLL', 'REFERENCE']);
const AUDIO_KINDS = new Set(['RAW_AUDIO', 'VO_PICKUP']);
const IMAGE_KINDS = new Set(['THUMBNAIL_DESIGN', 'GRAPHIC']);

/** Tiny deterministic bars used as an audio hint on the card. */
function MiniWave({ seed, bars = 22 }: { seed: string; bars?: number }) {
  const heights = useMemo(() => {
    let h = 2166136261;
    for (let i = 0; i < seed.length; i += 1) {
      h ^= seed.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    let x = h >>> 0;
    const rand = () => {
      x |= 0;
      x = (x + 0x6d2b79f5) | 0;
      let t = Math.imul(x ^ (x >>> 15), 1 | x);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return Array.from({ length: bars }, () => 0.2 + rand() * 0.8);
  }, [seed, bars]);
  return (
    <span className="pv-mini-wave" aria-hidden>
      {heights.map((height, index) => (
        <span key={index} style={{ height: `${height * 100}%` }} />
      ))}
    </span>
  );
}

/** Skeleton text lines hinting at the script editor. */
function MiniScript({ seed }: { seed: string }) {
  const widths = useMemo(() => {
    let h = 2166136261;
    for (let i = 0; i < seed.length; i += 1) {
      h ^= seed.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    let x = h >>> 0;
    const rand = () => {
      x |= 0;
      x = (x + 0x6d2b79f5) | 0;
      let t = Math.imul(x ^ (x >>> 15), 1 | x);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return Array.from({ length: 5 }, () => 55 + rand() * 40);
  }, [seed]);
  return (
    <span className="pv-mini-script" aria-hidden>
      {widths.map((width, index) => (
        <span key={index} style={{ width: `${width}%` }} />
      ))}
    </span>
  );
}

export default function PreviewPage() {
  const { projectId } = useParams<{ projectId: string }>();
  useProjectRealtime(projectId, null);
  const project = useGetVideoProject(projectId);

  if (project.isLoading) {
    return (
      <div className="page">
        <div className="panel-empty">Opening the preview room…</div>
      </div>
    );
  }

  if (project.isError || !project.data) {
    return (
      <div className="page">
        <div className="page-guide"><span className="guide-pin" /><div><b>PREVIEW CLOSED</b><span>This room is out of reach.</span></div></div>
        <h1 style={{ font: '700 43px var(--app-font-serif)', letterSpacing: '-.045em', margin: '9px 0 20px' }}>This room is out of reach.</h1>
        <Link href={`/projects/${projectId}`} className="secondary-btn"><ArrowLeft size={14} /> Back to the vault</Link>
      </div>
    );
  }

  const p = project.data;
  const assets = p.assets;
  const videoAssets = assets.filter((a) => VIDEO_KINDS.has(a.kind));
  const audioAssets = assets.filter((a) => AUDIO_KINDS.has(a.kind));
  const imageAssets = assets.filter((a) => IMAGE_KINDS.has(a.kind));
  const transcribed = assets.filter((a) => a.status === 'PROCESSED');
  const firstVideo = videoAssets.find((a) => a.status === 'PROCESSED') ?? videoAssets[0];
  const firstImage = imageAssets.find((a) => a.status === 'PROCESSED') ?? imageAssets[0];

  const cards = [
    {
      id: 'video',
      href: `/projects/${p.id}/preview/video`,
      title: 'Video',
      eyebrow: 'The picture',
      icon: <Film size={22} />,
      count: `${videoAssets.length} asset${videoAssets.length === 1 ? '' : 's'}`,
      description: 'Every selects pass and cut version, frame-by-frame with spatial annotations.',
      preview: firstVideo ? (
        <video className="pv-card-media" src={`${proxyUrlFor(p.id, firstVideo.id)}#t=0.5`} muted playsInline preload="metadata" />
      ) : (
        <span className="pv-card-media-icon"><Clapperboard size={30} /></span>
      ),
    },
    {
      id: 'audio',
      href: `/projects/${p.id}/preview/audio`,
      title: 'Audio',
      eyebrow: 'The sound',
      icon: <AudioLines size={22} />,
      count: `${audioAssets.length} asset${audioAssets.length === 1 ? '' : 's'}`,
      description: 'Waveform playback of every sound version — restoration, score and pickup pins.',
      preview: audioAssets.length > 0 ? (
        <MiniWave seed={`${p.id}-audio`} />
      ) : (
        <span className="pv-card-media-icon"><Mic2 size={30} /></span>
      ),
    },
    {
      id: 'script',
      href: `/projects/${p.id}/preview/script`,
      title: 'Script',
      eyebrow: 'The words',
      icon: <Type size={22} />,
      count: `${transcribed.length} transcribed`,
      description: 'The editable script. Import audio or video and the transcription types itself here.',
      preview: <MiniScript seed={`${p.id}-script`} />,
    },
    {
      id: 'thumbnail',
      href: `/projects/${p.id}/preview/thumbnail`,
      title: 'Thumbnail',
      eyebrow: 'The cover',
      icon: <ImageIcon size={22} />,
      count: `${imageAssets.length} design${imageAssets.length === 1 ? '' : 's'}`,
      description: 'Chosen designs across every thumbnail version — annotated as a static frame.',
      preview: firstImage ? (
        <img className="pv-card-media" src={proxyUrlFor(p.id, firstImage.id)} alt="" />
      ) : (
        <span className="pv-card-media-icon"><ImageIcon size={30} /></span>
      ),
    },
  ];

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <SectionEyebrow>Preview · review room</SectionEyebrow>
          <h1>The preview room.</h1>
          <p>Everything the relay produced, side by side — the picture, the sound, the words and the cover. Pick a card to open its preview studio.</p>
        </div>
        <div className="flex items-center gap-3">
          <Link href={`/projects/${p.id}`} className="secondary-btn" data-testid="preview-back-vault">
            <ArrowLeft size={14} />
            The vault
          </Link>
          <span className="den-tag teal"><Sparkles size={10} /> {p.status.replaceAll('_', ' ')}</span>
        </div>
      </div>

      <div className="pv-grid" data-testid="preview-grid">
        {cards.map((card) => (
          <Link key={card.id} href={card.href} className="pv-card" data-testid={`preview-card-${card.id}`}>
            <div className="pv-card-top">
              <span className="pv-card-icon">{card.icon}</span>
              <span className="pv-card-count mono-label">{card.count}</span>
            </div>
            <div className="pv-card-media-wrap">
              {card.preview}
            </div>
            <div className="pv-card-body">
              <span className="eyebrow">{card.eyebrow}</span>
              <h2>{card.title}</h2>
              <p>{card.description}</p>
            </div>
          </Link>
        ))}
      </div>

      <p className="den-footnote mt-8">
        <Sparkles size={13} />
        Annotations live on the frame, notes live on the timeline — every pin is colour-tagged to its reviewer, and nothing here unlocks the originals.
      </p>
    </div>
  );
}
