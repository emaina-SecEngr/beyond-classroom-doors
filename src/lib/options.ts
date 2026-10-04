/**
 * Pick-lists for every profile and admin form (D17). Shared by the browser (dropdowns)
 * and the server (validation), so both always agree. Lists with an "Other" choice
 * still accept a short typed value; the server caps its length.
 */

export const OTHER = '__other__'

export const PROFESSIONS = [
  'Registered Nurse',
  'Physician',
  'Pharmacist',
  'Dentist',
  'Physical Therapist',
  'Paramedic / EMT',
  'Medical Lab Scientist',
  'Civil Engineer',
  'Mechanical Engineer',
  'Electrical Engineer',
  'Software Engineer',
  'Cybersecurity Professional',
  'Data Scientist',
  'IT Support Specialist',
  'Architect',
  'Electrician',
  'Plumber',
  'HVAC Technician',
  'Welder',
  'Carpenter',
  'Automotive Technician',
  'Accountant',
  'Financial Analyst',
  'Attorney',
  'Police Officer',
  'Firefighter',
  'Military / Veteran',
  'Chef / Culinary',
  'Graphic Designer',
  'Journalist / Media',
  'Entrepreneur / Business Owner',
  'Marketing Professional',
  'Scientist / Researcher',
] as const

export const LICENSE_TYPES = [
  'Registered Nurse (RN)',
  'Licensed Vocational Nurse (LVN)',
  'Physician (MD/DO)',
  'Pharmacist',
  'Dentist',
  'Physical Therapist',
  'EMT / Paramedic',
  'Professional Engineer (PE)',
  'Licensed Architect',
  'Certified Public Accountant (CPA)',
  'Attorney (State Bar)',
  'Electrician (state certified)',
  'Contractor (CSLB)',
  'Real Estate',
  'Cosmetology / Barbering',
  'Teaching Credential',
] as const

export const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS',
  'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
] as const

/** Years of experience: "Less than 1" (0) … "40+" (40). */
export const YEARS = Array.from({ length: 41 }, (_, i) => ({ value: String(i), label: i === 0 ? 'Less than 1 year' : i === 40 ? '40+ years' : `${i} year${i === 1 ? '' : 's'}` }))

/** Practical things that help on the day (D14) — never a diagnosis. */
export const ACCESS_NEEDS = [
  'Step-free / wheelchair-accessible route',
  'Elevator or ground-floor room',
  'Parking close to the entrance',
  'A chair at the front',
  'Microphone or sound system',
  'Sign-language interpreter',
  'Large-print or high-contrast materials',
  'Extra time to set up',
] as const

export const DISTRICTS = [
  'San Diego Unified',
  'Sweetwater Union High',
  'Grossmont Union High',
  'Poway Unified',
  'San Dieguito Union High',
  'Escondido Union High',
  'Vista Unified',
  'Oceanside Unified',
] as const

export const CITIES = ['San Diego', 'Chula Vista', 'National City', 'El Cajon', 'La Mesa', 'Poway', 'Encinitas', 'Escondido', 'Vista', 'Oceanside'] as const

export const SUBJECTS = [
  'Career & Technical Education',
  'Health Science / Medical',
  'Engineering',
  'Computer Science',
  'Biology',
  'Chemistry',
  'Physics',
  'Mathematics',
  'English',
  'Social Studies',
  'Business',
  'Visual & Performing Arts',
  'College & Career Counseling',
  'Special Education',
] as const

export const MAX_PREFERRED_SCHOOLS = 5

/** "a; b; Other text" ⇄ { picked, other } for the access-needs checklist. */
export function splitAccessNeeds(text: string): { picked: string[]; other: string } {
  const parts = text
    .split(';')
    .map((p) => p.trim())
    .filter(Boolean)
  const known = new Set<string>(ACCESS_NEEDS)
  return { picked: parts.filter((p) => known.has(p)), other: parts.filter((p) => !known.has(p)).join('; ') }
}

export function joinAccessNeeds(picked: string[], other: string): string {
  const ordered = ACCESS_NEEDS.filter((a) => picked.includes(a))
  return [...ordered, other.trim()].filter(Boolean).join('; ')
}

/** D18: things a teacher may line up before a volunteer visits. She picks which apply and ticks them off. */
export const PREP_ITEMS = [
  'Visitor sign-in / badge arranged with the front office',
  'Parking pass or directions sent',
  'Room booked',
  'Projector and screen tested',
  'Wi-Fi guest access ready',
  'Students briefed and questions prepared',
  'Access needs arranged',
  'Counselor or administrator aware',
  'Supplies ready (markers, paper, handouts)',
  'Thank-you note planned',
] as const
