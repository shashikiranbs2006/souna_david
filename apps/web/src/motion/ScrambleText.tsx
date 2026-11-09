import { useRef, type ElementType, type ComponentPropsWithoutRef } from 'react';
import { useScramble, type ScrambleOptions } from './useScramble.ts';

type Props<E extends ElementType> = {
  as?: E;
  text: string;
} & ScrambleOptions & Omit<ComponentPropsWithoutRef<E>, 'children'>;

/**
 * Heading or label whose letters resolve from noise. Screen readers get the
 * real text once (visually hidden); the animated copy is aria-hidden.
 */
export function ScrambleText<E extends ElementType = 'span'>({ as, text, trigger, chars, duration, delay, speed, revealDelay, rightToLeft, ...rest }: Props<E>) {
  const Tag = (as ?? 'span') as ElementType;
  const ref = useRef<HTMLSpanElement>(null);
  const opts: ScrambleOptions = {};
  if (trigger) opts.trigger = trigger;
  if (chars) opts.chars = chars;
  if (duration !== undefined) opts.duration = duration;
  if (delay !== undefined) opts.delay = delay;
  if (speed !== undefined) opts.speed = speed;
  if (revealDelay !== undefined) opts.revealDelay = revealDelay;
  if (rightToLeft !== undefined) opts.rightToLeft = rightToLeft;
  useScramble(ref, text, opts);
  return (
    <Tag {...rest}>
      <span className="sr-only no-copy">{text}</span>
      {/* The box is sized by the final text (CSS draws it invisibly from data-text), and the
          animated copy is laid over it, so the noisy frames never reflow the line or the page. */}
      <span className="scramble-box" data-text={text} aria-hidden="true">
        <span ref={ref} className="scramble">
          {text}
        </span>
      </span>
    </Tag>
  );
}
