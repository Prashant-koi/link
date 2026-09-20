// Generated, obviously-synthetic identifiers — no real personal data.
// Static lists rather than a faker dependency, per the seed data handoff.

export const FIRST_NAMES = [
  "Alex", "Priya", "Jordan", "Wei", "Sam", "Noor", "Diego", "Ines", "Marcus",
  "Yuki", "Fatima", "Liam", "Chen", "Aisha", "Omar", "Nadia", "Kwame", "Elena",
  "Hiro", "Zoe", "Rafael", "Mei", "Tariq", "Sofia", "Aditya", "Grace", "Kofi",
  "Lena", "Theo", "Amara", "Ravi", "Nina", "Kai", "Layla", "Ben", "Mira",
  "Dmitri", "Ana", "Isaac", "Yara",
];

export const LAST_NAMES = [
  "Shah", "Reyes", "Webb", "Novak", "Okafor", "Kim", "Silva", "Haddad",
  "Chen", "Ibrahim", "Larsen", "Petrov", "Diaz", "Nakamura", "Osei",
  "Fischer", "Rahman", "Costa", "Volkov", "Nguyen", "Adeyemi", "Moreau",
  "Sato", "Kowalski", "Amari", "Blackwood", "Singh", "Torres", "Lindqvist",
  "Mensah", "Park", "Dubois", "Farouk", "Bergström", "Castro", "Yamamoto",
  "Osman", "Kessler", "Abara", "Voss",
];

export const DEPARTMENTS = [
  "Computer Science",
  "Electrical Engineering",
  "Mathematics",
  "Physics",
  "Design",
  "Cognitive Science",
  "Statistics",
  "Mechanical Engineering",
];

export const LAB_NAMES = [
  "Autonomous Systems Lab",
  "Applied Cryptography Lab",
  "Human-Centered Computing Lab",
  "Distributed Systems Group",
  "Robotics & Perception Lab",
  "Data Science Lab",
  "Networked Systems Lab",
  "Security Research Lab",
  "Interactive Media Lab",
  "Machine Intelligence Lab",
];

export const CLUB_NAMES = [
  "AI Club",
  "Robotics Club",
  "Cybersecurity Club",
  "Game Dev Club",
  "Design Club",
  "Open Source Club",
  "Data Science Club",
];

const COURSE_LEVELS = ["Intro to", "Foundations of", "Topics in", "Advanced"];
const EVENT_KINDS = ["Hack Night", "Symposium", "Workshop", "Demo Day", "Research Showcase"];
const PAPER_KINDS = ["Notes on", "Toward", "A Study of", "Rethinking"];

export function courseTitle(department: string, index: number): string {
  return `${COURSE_LEVELS[index % COURSE_LEVELS.length]} ${department}`;
}

export function eventTitle(index: number): string {
  return `${EVENT_KINDS[index % EVENT_KINDS.length]} ${2024 + (index % 3)}`;
}

export function paperTitle(concept: string, index: number): string {
  return `${PAPER_KINDS[index % PAPER_KINDS.length]} ${concept}`;
}
