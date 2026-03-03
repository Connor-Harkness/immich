<script lang="ts">
  import type { OcrBox } from '$lib/utils/ocr-utils';
  import { calculateBoundingBoxMatrix, calculateFittedFontSize } from '$lib/utils/ocr-utils';

  type Props = {
    ocrBox: OcrBox;
  };

  let { ocrBox }: Props = $props();

  const dimensions = $derived(calculateBoundingBoxMatrix(ocrBox.points));

  const transform = $derived(`matrix3d(${dimensions.matrix.join(',')})`);
  const fontSize = $derived(calculateFittedFontSize(ocrBox.text, dimensions.width, dimensions.height) + 'px');
</script>

<div class="absolute left-0 top-0">
  <div
    class="absolute flex items-center justify-center text-transparent border-2 border-blue-500 bg-blue-500/10 px-2 py-1 pointer-events-auto cursor-text whitespace-nowrap select-text transition-colors hover:z-10 hover:text-white hover:bg-black/60 hover:border-blue-600 hover:border-3 focus:z-10 focus:text-white focus:bg-black/60 focus:border-blue-600 focus:border-3 focus:outline-none"
    style="font-size: {fontSize}; width: {dimensions.width}px; height: {dimensions.height}px; transform: {transform}; transform-origin: 0 0;"
    tabindex="0"
    role="button"
    aria-label={ocrBox.text}
  >
    {ocrBox.text}
  </div>
</div>
