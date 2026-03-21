"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Search } from 'lucide-react';
import { INQUIRY_TOPICS } from '@/data/inquiry-topics';
import type { InquiryTopic, InquiryStatus } from '@/data/inquiry-topics';

interface InquiryFiltersProps {
  topicFilter: InquiryTopic | 'all';
  statusFilter: InquiryStatus | 'all';
  searchQuery: string;
  onTopicChange: (value: InquiryTopic | 'all') => void;
  onStatusChange: (value: InquiryStatus | 'all') => void;
  onSearchChange: (value: string) => void;
}

export function InquiryFilters({
  topicFilter,
  statusFilter,
  searchQuery,
  onTopicChange,
  onStatusChange,
  onSearchChange,
}: InquiryFiltersProps) {
  return (
    <div className="flex flex-col sm:flex-row gap-3">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by subject or sender..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-9 rounded-xl"
        />
      </div>
      <Select value={topicFilter} onValueChange={(v) => onTopicChange(v as InquiryTopic | 'all')}>
        <SelectTrigger className="w-full sm:w-[180px]">
          <SelectValue placeholder="All Topics" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Topics</SelectItem>
          {INQUIRY_TOPICS.map((t) => (
            <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={statusFilter} onValueChange={(v) => onStatusChange(v as InquiryStatus | 'all')}>
        <SelectTrigger className="w-full sm:w-[160px]">
          <SelectValue placeholder="All Statuses" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Statuses</SelectItem>
          <SelectItem value="open">Open</SelectItem>
          <SelectItem value="in_progress">In Progress</SelectItem>
          <SelectItem value="resolved">Resolved</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
