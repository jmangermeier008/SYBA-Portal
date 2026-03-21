import type { OfficerTitle } from './officers';

export interface InquiryTopicConfig {
  value: InquiryTopic;
  label: string;
  assignedToRole: OfficerTitle;
  description: string;
}

export const INQUIRY_TOPICS: InquiryTopicConfig[] = [
  {
    value: 'registration',
    label: 'Registration',
    assignedToRole: 'Secretary',
    description: 'Registration questions, eligibility, enrollment issues',
  },
  {
    value: 'concessions',
    label: 'Concessions',
    assignedToRole: 'Building/Grounds Committee Chair',
    description: 'Concession stand schedules, volunteering, supplies',
  },
  {
    value: 'fundraising',
    label: 'Fundraising',
    assignedToRole: 'Finance Committee Chair',
    description: 'Fundraising events, sponsorships, donations',
  },
  {
    value: 'uniforms',
    label: 'Uniforms',
    assignedToRole: 'Equipment Coordinator',
    description: 'Uniform sizes, distribution, returns, replacements',
  },
  {
    value: 'field_maintenance',
    label: 'Field Maintenance',
    assignedToRole: 'Building/Grounds Committee Chair',
    description: 'Field conditions, maintenance requests, facility issues',
  },
  {
    value: 'scheduling',
    label: 'Game Scheduling',
    assignedToRole: 'Competition Committee Chair',
    description: 'Game schedules, rainouts, rescheduling',
  },
  {
    value: 'general',
    label: 'General Question',
    assignedToRole: 'President',
    description: 'Anything not covered by the other categories',
  },
];

export type InquiryTopic = 'registration' | 'concessions' | 'fundraising' | 'uniforms' | 'field_maintenance' | 'scheduling' | 'general';

export type InquiryStatus = 'open' | 'in_progress' | 'resolved';

export interface InquiryReply {
  id: string;
  authorId: string;
  authorName: string;
  authorRole: string;
  message: string;
  createdAt: string;
}

export interface Inquiry {
  id: string;
  senderId: string;
  senderName: string;
  senderEmail: string;
  senderRole: 'Parent' | 'Coach';
  topic: InquiryTopic;
  subject: string;
  message: string;
  status: InquiryStatus;
  assignedToRole: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  replies: InquiryReply[];
}

export function getTopicConfig(topic: InquiryTopic): InquiryTopicConfig | undefined {
  return INQUIRY_TOPICS.find(t => t.value === topic);
}
