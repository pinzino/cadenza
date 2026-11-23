export type PlannerPriority = 'Alta' | 'Media' | 'Bassa';

export type PlannerTask = {
  id: string;
  title: string;
  category: 'Lavoro' | 'Personale';
  priority: PlannerPriority;
  duration_minutes: number;
  scheduled_date: string | null;
  scheduled_time: string | null;
  is_complete: boolean;
};

export type PlannerSettings = {
  workWindows: TimeWindow[];
  personalWindows: TimeWindow[];
  maxBlockMinutes: number;
  breakMinutes: number;
};

export type TimeWindow = { start: string; end: string };

export type PlannedBlock = {
  task_id: string;
  block_date: string;
  start_time: string;
  end_time: string;
  duration_minutes: number;
  block_index: number;
  total_blocks: number;
  is_fixed: boolean;
};

export type PlanResult = {
  blocks: PlannedBlock[];
  unscheduledTaskIds: string[];
};

const priorityWeight: Record<PlannerPriority, number> = { Alta: 3, Media: 2, Bassa: 1 };

export function timeToMinutes(time: string) {
  const [hours, minutes] = time.slice(0, 5).split(':').map(Number);
  return hours * 60 + minutes;
}

export function minutesToTime(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(remainingMinutes).padStart(2, '0')}:00`;
}

function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(date: Date, amount: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + amount);
  return result;
}

export function buildAutomaticPlan(tasks: PlannerTask[], settings: PlannerSettings, startDate = new Date()): PlanResult {
  const activeTasks = tasks.filter((task) => !task.is_complete);
  const blocks: PlannedBlock[] = [];
  const fixedRemainders = new Map<string, number>();

  for (const task of activeTasks.filter((item) => item.scheduled_date && item.scheduled_time)) {
    const start = timeToMinutes(task.scheduled_time!);
    const fixedDuration = Math.min(task.duration_minutes, Math.max(1, 1440 - start));
    blocks.push({
      task_id: task.id,
      block_date: task.scheduled_date!,
      start_time: minutesToTime(start),
      end_time: minutesToTime(start + fixedDuration),
      duration_minutes: fixedDuration,
      block_index: 1,
      total_blocks: 1,
      is_fixed: true,
    });
    if (task.duration_minutes > fixedDuration) fixedRemainders.set(task.id, task.duration_minutes - fixedDuration);
  }

  const flexibleTasks = activeTasks
    .filter((task) => !task.scheduled_time || fixedRemainders.has(task.id))
    .map((task) => fixedRemainders.has(task.id) ? { ...task, duration_minutes: fixedRemainders.get(task.id)!, scheduled_time: null } : task)
    .sort((first, second) => {
      const deadlineFirst = first.scheduled_date ?? '9999-12-31';
      const deadlineSecond = second.scheduled_date ?? '9999-12-31';
      if (deadlineFirst !== deadlineSecond) return deadlineFirst.localeCompare(deadlineSecond);
      const priorityDifference = priorityWeight[second.priority] - priorityWeight[first.priority];
      if (priorityDifference) return priorityDifference;
      return first.duration_minutes - second.duration_minutes;
    });

  const unscheduledTaskIds: string[] = [];
  const firstPlanningDate = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());

  for (const task of flexibleTasks) {
    let remaining = task.duration_minutes;
    const taskBlocks: PlannedBlock[] = [];

    for (let dayOffset = 0; dayOffset < 90 && remaining > 0; dayOffset += 1) {
      const availableWindows = (task.category === 'Lavoro' ? settings.workWindows : settings.personalWindows)
        .map((window) => ({ start: timeToMinutes(window.start), end: timeToMinutes(window.end) }))
        .sort((first, second) => first.start - second.start);
      const currentDate = addDays(firstPlanningDate, dayOffset);
      const currentDateKey = dateKey(currentDate);
      const occupied = blocks
        .filter((block) => block.block_date === currentDateKey)
        .map((block) => ({ start: timeToMinutes(block.start_time), end: timeToMinutes(block.end_time) }))
        .sort((first, second) => first.start - second.start);

      for (const window of availableWindows) {
        if (remaining <= 0) break;
        let cursor = window.start;
        const boundaries = [
          ...occupied.filter((interval) => interval.end > window.start && interval.start < window.end),
          { start: window.end, end: window.end },
        ];

        for (const boundary of boundaries) {
          if (remaining <= 0) break;
          if (boundary.end <= cursor) continue;

          const available = Math.max(0, Math.min(boundary.start, window.end) - cursor);
          if (available > 0) {
            const duration = Math.min(remaining, settings.maxBlockMinutes, available);
            const block: PlannedBlock = {
              task_id: task.id,
              block_date: currentDateKey,
              start_time: minutesToTime(cursor),
              end_time: minutesToTime(cursor + duration),
              duration_minutes: duration,
              block_index: 1,
              total_blocks: 1,
              is_fixed: false,
            };
            taskBlocks.push(block);
            blocks.push(block);
            remaining -= duration;
            cursor += duration + settings.breakMinutes;
          }

          cursor = Math.max(cursor, boundary.end + settings.breakMinutes);
          if (cursor >= window.end) break;
        }
      }
    }

    const totalBlocks = taskBlocks.length;
    taskBlocks.forEach((block, index) => {
      block.block_index = index + 1;
      block.total_blocks = totalBlocks;
    });
    if (remaining > 0) unscheduledTaskIds.push(task.id);
  }

  return {
    blocks: blocks.sort((first, second) => `${first.block_date}${first.start_time}`.localeCompare(`${second.block_date}${second.start_time}`)),
    unscheduledTaskIds,
  };
}
