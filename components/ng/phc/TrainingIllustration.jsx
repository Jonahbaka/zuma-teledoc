/**
 * PHC field-guide illustration.
 *
 * The field guide is read on the same intermittent, low-bandwidth connections
 * the FCT PHCB assessment described, so every illustration ships as a small
 * WebP (tens of KB) with an optimized PNG fallback, explicit dimensions to
 * avoid layout shift, and lazy loading. Regenerate the encoded variants with:
 *
 *   node scripts/optimize-training-assets.cjs
 */
export default function TrainingIllustration({
  name,
  alt,
  priority = false,
  className = 'h-48 w-full object-cover bg-slate-100',
}) {
  return (
    <picture>
      <source srcSet={`/images/training/${name}.webp`} type="image/webp" />
      <img
        src={`/images/training/${name}.png`}
        alt={alt}
        width={1536}
        height={1024}
        loading={priority ? 'eager' : 'lazy'}
        decoding="async"
        fetchPriority={priority ? 'high' : 'auto'}
        className={className}
      />
    </picture>
  );
}
