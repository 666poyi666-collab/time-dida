// 数据导出 - JSON / CSV / Markdown
import { getSession, listSegments, listPauses } from './db/index.js';
import type { FocusSession, FocusSegment, PauseEvent } from '@shared/types';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function fmtDateTime(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}`;
}

function minStr(ms: number): string {
  return `${Math.round(ms / 60000)} 分钟`;
}

export function exportSession(
  session: FocusSession,
  segments: FocusSegment[],
  pauses: PauseEvent[],
  format: 'json' | 'csv' | 'markdown'
): string {
  if (format === 'json') {
    return JSON.stringify({ session, segments, pauses }, null, 2);
  }
  if (format === 'csv') {
    const rows = [
      'type,id,startedAt,endedAt,activeMs,pauseMs,wallMs,taskId,title',
      `session,${session.id},${fmtDateTime(session.startedAt)},${
        session.endedAt ? fmtDateTime(session.endedAt) : ''
      },${session.activeElapsedMs},${session.pauseElapsedMs},${session.wallElapsedMs},${
        session.defaultTaskId ?? ''
      },${session.title ?? ''}`,
    ];
    for (const s of segments) {
      rows.push(
        `segment,${s.id},${fmtDateTime(s.startedAt)},${
          s.endedAt ? fmtDateTime(s.endedAt) : ''
        },${s.activeElapsedMs},,${s.taskId ?? ''},${s.title ?? ''}`
      );
    }
    for (const p of pauses) {
      rows.push(
        `pause,${p.id},${fmtDateTime(p.pauseStartedAt)},${
          p.pauseEndedAt ? fmtDateTime(p.pauseEndedAt) : ''
        },,${p.durationMs},,`
      );
    }
    return rows.join('\n');
  }
  // markdown
  const lines: string[] = [];
  lines.push('# Focus Session');
  lines.push('');
  lines.push(`开始时间：${fmtDateTime(session.startedAt)}`);
  lines.push(
    `结束时间：${session.endedAt ? fmtDateTime(session.endedAt) : '进行中'}`
  );
  lines.push('');
  lines.push(`专注时长：${minStr(session.activeElapsedMs)}`);
  lines.push(`暂停时长：${minStr(session.pauseElapsedMs)}`);
  lines.push(`总跨度：${minStr(session.wallElapsedMs)}`);
  lines.push('');
  lines.push('## Segments');
  segments.forEach((s, i) => {
    lines.push('');
    lines.push(`### Segment ${i + 1}`);
    lines.push('');
    lines.push(`- 时间：${fmtDateTime(s.startedAt)} - ${
      s.endedAt ? fmtDateTime(s.endedAt) : '进行中'
    }`);
    lines.push(`- 专注：${minStr(s.activeElapsedMs)}`);
    lines.push(`- 任务：${s.title ?? s.taskId ?? '未关联'}`);
    if (s.note) lines.push(`- 备注：${s.note}`);
  });
  if (pauses.length > 0) {
    lines.push('');
    lines.push('## Pauses');
    pauses.forEach((p, i) => {
      lines.push('');
      lines.push(`### Pause ${i + 1}`);
      lines.push('');
      lines.push(`- 时间：${fmtDateTime(p.pauseStartedAt)} - ${
        p.pauseEndedAt ? fmtDateTime(p.pauseEndedAt) : '进行中'
      }`);
      lines.push(`- 时长：${minStr(p.durationMs)}`);
    });
  }
  return lines.join('\n');
}

export function exportSessionById(
  sessionId: string,
  format: 'json' | 'csv' | 'markdown'
): string {
  const session = getSession(sessionId);
  if (!session) throw new Error(`session 不存在: ${sessionId}`);
  const segments = listSegments(sessionId);
  const pauses = listPauses(sessionId);
  return exportSession(session, segments, pauses, format);
}
