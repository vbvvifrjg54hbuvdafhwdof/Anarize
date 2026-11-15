import katex from 'katex';
import { useMemo } from 'react';

interface MathTextProps {
  text: string;
  className?: string;
}

interface TextSegment {
  type: 'text' | 'inline-math' | 'display-math';
  content: string;
}

function tokenizeMath(input: string): TextSegment[] {
  const segments: TextSegment[] = [];
  const regex = /\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(input)) !== null) {
    if (match.index > lastIndex) {
      segments.push({
        type: 'text',
        content: input.slice(lastIndex, match.index),
      });
    }
    if (match[1] !== undefined) {
      segments.push({ type: 'display-math', content: match[1] });
    } else if (match[2] !== undefined) {
      segments.push({ type: 'inline-math', content: match[2] });
    } else if (match[3] !== undefined) {
      segments.push({ type: 'display-math', content: match[3] });
    } else if (match[4] !== undefined) {
      segments.push({ type: 'inline-math', content: match[4] });
    }
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < input.length) {
    segments.push({
      type: 'text',
      content: input.slice(lastIndex),
    });
  }

  return segments;
}

export function MathText({ text, className = '' }: MathTextProps) {
  const segments = useMemo(() => tokenizeMath(text), [text]);

  return (
    <span className={`whitespace-pre-wrap break-words ${className}`}>
      {segments.map((seg, idx) => {
        if (seg.type === 'text') {
          return <span key={idx}>{seg.content}</span>;
        }
        try {
          const html = katex.renderToString(seg.content, {
            displayMode: seg.type === 'display-math',
            throwOnError: false,
            strict: false,
          });
          return (
            <span
              key={idx}
              className={seg.type === 'display-math' ? 'block my-2 overflow-x-auto' : 'inline-block align-baseline mx-0.5'}
              dangerouslySetInnerHTML={{ __html: html }}
            />
          );
        } catch {
          return <span key={idx}>{seg.content}</span>;
        }
      })}
    </span>
  );
}
