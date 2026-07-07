// 数据导出 - JSON / CSV / Markdown
import { getSession, listSegments, listPauses } from './db/index.js';
import type { FocusSession, FocusSegment, PauseEvent } from '@shared/types';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function fmtDateTime(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}`;
}

function minStr(ms: number): string {
  return `${Math.round(ms / 60000)} 分钟`;
}

/** CSV 转义：含逗号、引号、换行的字段用双引号包裹，内部引号转义为两个引号 */
function csvEscape(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  // 防止公式注入：以 = + - @ 开头的字段前缀单引号
  if (/^[=+\-@]/.test(s)) return `'${s}`;
  return s;
}

export function exportSession(
  session: FocusSession,
  segments: FocusSegment[],
  pauses: PauseEvent[],
  format: 'json' | 'csv' | 'markdown',
): string {
  if (format === 'json') {
    return JSON.stringify({ session, segments, pauses }, null, 2);
  }
  if (format === 'csv') {
    const rows = [
      'type,id,startedAt,endedAt,activeMs,pauseMs,wallMs,taskId,title',
      `session,${csvEscape(session.id)},${csvEscape(fmtDateTime(session.startedAt))},${
        session.endedAt ? csvEscape(fmtDateTime(session.endedAt)) : ''
      },${session.activeElapsedMs},${session.pauseElapsedMs},${session.wallElapsedMs},${
        csvEscape(session.defaultTaskId)
      },${csvEscape(session.title)}`,
    ];
    for (const s of segments) {
      rows.push(
        `segment,${csvEscape(s.id)},${csvEscape(fmtDateTime(s.startedAt))},${
          s.endedAt ? csvEscape(fmtDateTime(s.endedAt)) : ''
        },${s.activeElapsedMs},,,${csvEscape(s.taskId)},${csvEscape(s.title)}`,
      );
    }
    for (const p of pauses) {
      rows.push(
        `pause,${csvEscape(p.id)},${csvEscape(fmtDateTime(p.pauseStartedAt))},${
          p.pauseEndedAt ? csvEscape(fmtDateTime(p.pauseEndedAt)) : ''
        },,${p.durationMs},,,`,
      );
    }
    return rows.join('\n');
  }
  // markdown
  const lines: string[] = [];
  lines.push('# Focus Session');
  lines.push('');
  lines.push(`开始时间：${fmtDateTime(session.startedAt)}`);
  lines.push(`结束时间：${session.endedAt ? fmtDateTime(session.endedAt) : '进行中'}`);
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
    lines.push(
      `- 时间：${fmtDateTime(s.startedAt)} - ${s.endedAt ? fmtDateTime(s.endedAt) : '进行中'}`,
    );
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
      lines.push(
        `- 时间：${fmtDateTime(p.pauseStartedAt)} - ${
          p.pauseEndedAt ? fmtDateTime(p.pauseEndedAt) : '进行中'
        }`,
      );
      lines.push(`- 时长：${minStr(p.durationMs)}`);
    });
  }
  return lines.join('\n');
}

export function exportSessionById(sessionId: string, format: 'json' | 'csv' | 'markdown'): string {
  const session = getSession(sessionId);
  if (!session) throw new Error(`session 不存在: ${sessionId}`);
  const segments = listSegments(sessionId);
  const pauses = listPauses(sessionId);
  return exportSession(session, segments, pauses, format);
}
