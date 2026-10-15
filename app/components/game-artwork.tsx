import Image from "next/image";
const templates = new Set([
  "word-race",
  "picture",
  "odd-one-out",
  "mystery-box",
  "brain-battle",
]);
/** Shared visual identity; decorative artwork never encodes a scored answer. */
export function GameArtwork({
  template,
  className = "",
  priority = false,
}: {
  template: string;
  className?: string;
  priority?: boolean;
}) {
  const key = templates.has(template) ? template : "word-race";
  return (
    <div
      className={`game-artwork ${className}`}
      data-template={key}
      aria-hidden="true"
    >
      <Image
        src={`/artwork/${key}.png`}
        alt=""
        width={1536}
        height={1024}
        sizes="(max-width: 750px) 100vw, (max-width: 1100px) 50vw, 600px"
        preload={priority}
      />
    </div>
  );
}
/** Preserve existing teacher copies and session snapshots while upgrading the stock illustration. */
export function QuestionArtwork({ src, alt }: { src: string; alt: string }) {
  if (src !== "/elephant.svg")
    return <img className="question-image" src={src} alt={alt} />;
  return (
    <Image
      className="question-image"
      src="/artwork/picture-scene.png"
      alt={alt}
      width={1536}
      height={1024}
      sizes="(max-width: 750px) 100vw, 600px"
    />
  );
}
