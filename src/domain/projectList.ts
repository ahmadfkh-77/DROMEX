import type {Project} from './loads';

/**
 * What a Projects list card may show before a project is opened: its name, status in words, location,
 * start date, and the date of its latest recorded work. Everything else (customer, notes, totals,
 * actions) lives inside the project. A value that is absent stays null so the card can say so or hide
 * it; nothing is invented to fill the space.
 */
export type ProjectCardSummary = {
  name: string;
  status: 'Active' | 'Completed';
  location: string | null;
  startDate: string | null;
  lastActivityDate: string | null;
};

const isoDay = (value: string | null | undefined) => (value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null);

export function summarizeProjectCard(project: Project, lastActivityDate: string | null | undefined): ProjectCardSummary {
  return {
    name: project.name.trim(),
    status: project.status === 'completed' ? 'Completed' : 'Active',
    location: project.location.trim() || null,
    startDate: isoDay(project.startDate),
    lastActivityDate: isoDay(lastActivityDate),
  };
}
