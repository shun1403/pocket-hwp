import { TextToSpeech } from '@capacitor-community/text-to-speech';
import { isNative } from './files';

/** 이 기기에서 소리 내어 읽기를 쓸 수 있나 (안드로이드·iOS 앱은 기기 음성 엔진을 쓴다) */
export function canSpeak(): boolean {
  return isNative || (typeof window !== 'undefined' && 'speechSynthesis' in window);
}

/** 음성 엔진이 한 번에 읽기 좋은 길이로 나눈다 (문장 단위, 너무 긴 문장은 쉼표에서). */
export function speechChunks(paragraph: string, max = 220): string[] {
  const text = paragraph.replace(/\s+/g, ' ').trim();
  if (!text) return [];
  if (text.length <= max) return [text];
  const sentences = text.match(/[^.!?。？！]+[.!?。？！]*\s*/g) ?? [text];
  const out: string[] = [];
  let cur = '';
  const push = (s: string) => {
    if (cur && (cur + s).length > max) {
      out.push(cur.trim());
      cur = '';
    }
    cur += s;
  };
  for (const s of sentences) {
    if (s.length <= max) push(s);
    else for (const part of s.match(/[^,，、]+[,，、]?\s*/g) ?? [s]) push(part);
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/**
 * 문단을 차례로 읽는다. stop() 하거나 새로 시작하면 이전 읽기는 조용히 끝난다.
 */
export class Speaker {
  private generation = 0;
  rate = 1;

  /** from 번째 문단부터 읽는다. onParagraph 로 지금 읽는 문단을 알린다. */
  async play(paragraphs: string[], from: number, onParagraph: (index: number) => void, onDone: () => void): Promise<void> {
    const gen = ++this.generation;
    for (let i = from; i < paragraphs.length; i += 1) {
      if (gen !== this.generation) return;
      onParagraph(i);
      for (const chunk of speechChunks(paragraphs[i])) {
        if (gen !== this.generation) return;
        try {
          await TextToSpeech.speak({ text: chunk, lang: 'ko-KR', rate: this.rate, category: 'playback' });
        } catch {
          if (gen === this.generation) {
            this.generation += 1;
            onDone();
          }
          return;
        }
      }
    }
    if (gen === this.generation) onDone();
  }

  stop(): void {
    this.generation += 1;
    void TextToSpeech.stop().catch(() => undefined);
  }
}
