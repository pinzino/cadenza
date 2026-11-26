export type PlannerPriority = 'Alta' | 'Media' | 'Bassa';

export type PlannerTask = {
  id: string;
  title: string;
  category: 'Lavoro' | 'Personale';
  priority: PlannerPriority;
  duration_minutes: number;
  scheduled_date: string | null;
  scheduled_date_kind: 'exact' | 'deadline';
  scheduled_time: string | null;
  scheduled_window_start: string | null;
  scheduled_window_end: string | null;
  is_complete: boolean;
  exclude_from_plan: boolean;
  is_splittable: boolean;
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
  is_manual: boolean;
};

export type PlannerBusyInterval = {
  block_date: string;
  start_time: string;
  end_time: string;
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

export function formatTimeInput(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 4);
  return digits.length > 2 ? `${digits.slice(0, 2)}:${digits.slice(2)}` : digits;
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

export function isBlockExpired(block: Pick<PlannedBlock, 'block_date' | 'end_time'>, now: Date) {
  const today = dateKey(now);
  return block.block_date < today || (block.block_date === today && timeToMinutes(block.end_time) <= now.getHours() * 60 + now.getMinutes());
}

export function buildAutomaticPlan(
  tasks: PlannerTask[],
  settings: PlannerSettings,
  startDate = new Date(),
  manualBlocks: PlannedBlock[] = [],
  busyIntervals: PlannerBusyInterval[] = [],
): PlanResult {
  const activeTasks = tasks.filter((task) => !task.is_complete && !task.exclude_from_plan);
  const activeTaskIds = new Set(activeTasks.map((task) => task.id));
  const currentManualBlocks = manualBlocks.filter((block) => activeTaskIds.has(block.task_id) && !isBlockExpired(block, startDate));
  const blocks: PlannedBlock[] = currentManualBlocks.map((block) => ({ ...block, is_manual: true }));
  const fixedRemainders = new Map<string, number>();
  const manuallyAllocatedMinutes = new Map<string, number>();

  currentManualBlocks.forEach((block) => {
    manuallyAllocatedMinutes.set(block.task_id, (manuallyAllocatedMinutes.get(block.task_id) ?? 0) + block.duration_minutes);
  });

  const isPastFixedTask = (task: PlannerTask) => {
    if (!task.scheduled_date || !task.scheduled_time) return false;
    const today = dateKey(startDate);
    return task.scheduled_date < today || (task.scheduled_date === today && timeToMinutes(task.scheduled_time) < startDate.getHours() * 60 + startDate.getMinutes() + startDate.getSeconds() / 60);
  };

  for (const task of activeTasks.filter((item) => item.scheduled_date && item.scheduled_time && !manuallyAllocatedMinutes.has(item.id) && !isPastFixedTask(item))) {
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
      is_manual: false,
    });
    if (task.duration_minutes > fixedDuration) fixedRemainders.set(task.id, task.duration_minutes - fixedDuration);
  }

  const flexibleTasks = activeTasks
    .filter((task) => !task.scheduled_time || fixedRemainders.has(task.id) || manuallyAllocatedMinutes.has(task.id) || isPastFixedTask(task))
    .map((task) => {
      const originalDuration = fixedRemainders.has(task.id) ? fixedRemainders.get(task.id)! : task.duration_minutes;
      return {
        ...task,
        duration_minutes: Math.max(0, originalDuration - (manuallyAllocatedMinutes.get(task.id) ?? 0)),
        scheduled_time: null,
      };
    })
    .filter((task) => task.duration_minutes > 0)
    .sort((first, second) => {
      const deadlineFirst = first.scheduled_date ?? '9999-12-31';
      const deadlineSecond = second.scheduled_date ?? '9999-12-31';
      if (deadlineFirst !== deadlineSecond) return deadlineFirst.localeCompare(deadlineSecond);
      if (first.scheduled_date_kind !== second.scheduled_date_kind) return first.scheduled_date_kind === 'exact' ? -1 : 1;
      const priorityDifference = priorityWeight[second.priority] - priorityWeight[first.priority];
      if (priorityDifference) return priorityDifference;
      return first.duration_minutes - second.duration_minutes;
    });

  const unscheduledTaskIds: string[] = [];
  const firstPlanningDate = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
  const firstPlanningDateKey = dateKey(firstPlanningDate);

  for (const task of flexibleTasks) {
    let remaining = task.duration_minutes;
    const taskBlocks: PlannedBlock[] = [];

    for (let dayOffset = 0; dayOffset < 90 && remaining > 0; dayOffset += 1) {
      const forcedStart = task.scheduled_window_start ? timeToMinutes(task.scheduled_window_start) : 0;
      const forcedEnd = task.scheduled_window_end ? timeToMinutes(task.scheduled_window_end) : 1440;
      const availableWindows = (task.category === 'Lavoro' ? settings.workWindows : settings.personalWindows)
        .map((window) => ({ start: Math.max(timeToMinutes(window.start), forcedStart), end: Math.min(timeToMinutes(window.end), forcedEnd) }))
        .filter((window) => window.start < window.end)
        .sort((first, second) => first.start - second.start);
      const currentDate = addDays(firstPlanningDate, dayOffset);
      const currentDateKey = dateKey(currentDate);
      const requestedDate = task.scheduled_date && task.scheduled_date >= firstPlanningDateKey && !isPastFixedTask(task) ? task.scheduled_date : null;
      if (requestedDate && task.scheduled_date_kind === 'exact' && currentDateKey !== requestedDate) continue;
      if (requestedDate && task.scheduled_date_kind === 'deadline' && currentDateKey > requestedDate) break;
      const occupied = [...blocks, ...busyIntervals]
        .filter((block) => block.block_date === currentDateKey)
        .map((block) => ({ start: timeToMinutes(block.start_time), end: timeToMinutes(block.end_time) }))
        .sort((first, second) => first.start - second.start);

      for (const window of availableWindows) {
        if (remaining <= 0) break;
        const earliestStart = dayOffset === 0
          ? Math.ceil(startDate.getHours() * 60 + startDate.getMinutes() + startDate.getSeconds() / 60 + startDate.getMilliseconds() / 60000)
          : 0;
        let cursor = Math.max(window.start, earliestStart);
        if (cursor >= window.end) continue;
        const boundaries = [
          ...occupied.filter((interval) => interval.end > window.start && interval.start < window.end),
          { start: window.end, end: window.end },
        ];

        for (const boundary of boundaries) {
          if (remaining <= 0) break;
          if (boundary.end <= cursor) continue;

          const available = Math.max(0, Math.min(boundary.start, window.end) - cursor);
          if (available > 0) {
            const duration = task.is_splittable
              ? Math.min(remaining, settings.maxBlockMinutes, available)
              : available >= remaining ? remaining : 0;
            if (duration <= 0) {
              cursor = Math.max(cursor, boundary.end + settings.breakMinutes);
              continue;
            }
            const block: PlannedBlock = {
              task_id: task.id,
              block_date: currentDateKey,
              start_time: minutesToTime(cursor),
              end_time: minutesToTime(cursor + duration),
              duration_minutes: duration,
              block_index: 1,
              total_blocks: 1,
              is_fixed: false,
              is_manual: false,
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

    if (remaining > 0) unscheduledTaskIds.push(task.id);
  }

  const blocksByTask = new Map<string, PlannedBlock[]>();
  blocks.forEach((block) => blocksByTask.set(block.task_id, [...(blocksByTask.get(block.task_id) ?? []), block]));
  blocksByTask.forEach((taskBlocks) => {
    taskBlocks.sort((first, second) => `${first.block_date}${first.start_time}`.localeCompare(`${second.block_date}${second.start_time}`));
    taskBlocks.forEach((block, index) => {
      block.block_index = index + 1;
      block.total_blocks = taskBlocks.length;
    });
  });

  return {
    blocks: blocks.sort((first, second) => `${first.block_date}${first.start_time}`.localeCompare(`${second.block_date}${second.start_time}`)),
    unscheduledTaskIds,
  };
}
