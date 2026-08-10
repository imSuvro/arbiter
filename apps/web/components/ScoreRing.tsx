export function ScoreRing({ score }: Readonly<{ score: number | null }>) {
  const value = score === null ? 0 : Math.max(0, Math.min(100, score));
  return (
    <div
      className="score-ring"
      style={{ '--score': `${value * 3.6}deg` } as React.CSSProperties}
      aria-label={score === null ? 'No score yet' : `Score ${score} out of 100`}
    >
      <div className="score-ring__inner">
        <strong>{score === null ? '—' : score}</strong>
        <span>score</span>
      </div>
    </div>
  );
}
