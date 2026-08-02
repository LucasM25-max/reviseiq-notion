// Exam-date derived data shared by the sidebar and the calendar view.
import { store } from "./state.js";
import { daysUntil } from "./utils.js";

export function computeNextExam() {
  let best = null;
  const pages = store.state.pages;
  for (const id in pages) {
    const p = pages[id];
    if (p.type !== "subject" || !p.examDates) continue;
    for (let i = 0; i < p.examDates.length; i++) {
      const ex = p.examDates[i];
      const d = daysUntil(ex.date);
      if (d === null || d < 0) continue;
      if (!best || d < best.days) {
        best = { days: d, name: ex.name, subject: p.title, subjectId: p.id, date: ex.date };
      }
    }
  }
  return best;
}

export function computeAllExamRows() {
  const rows = [];
  const pages = store.state.pages;
  for (const id in pages) {
    const p = pages[id];
    if (p.type !== "subject" || !p.examDates) continue;
    for (let i = 0; i < p.examDates.length; i++) {
      const ex = p.examDates[i];
      rows.push({
        subjectId: p.id,
        subjectTitle: p.title || "Untitled",
        subjectIcon: p.icon,
        examId: ex.id,
        name: ex.name,
        date: ex.date
      });
    }
  }
  const upcoming = rows.filter((r) => {
    const d = daysUntil(r.date);
    return d !== null && d >= 0;
  });
  const past = rows.filter((r) => {
    const d = daysUntil(r.date);
    return d !== null && d < 0;
  });
  upcoming.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  past.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return { upcoming, past };
}
