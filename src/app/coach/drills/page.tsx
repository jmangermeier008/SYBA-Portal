"use client";

import { useState } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dumbbell, Clock, Users, ChevronDown, ChevronUp } from 'lucide-react';

// L5: Drills are currently stored as a static array. When the library grows, consider
// migrating to a Firestore 'drills' collection to support admin-managed content, custom drills,
// and per-team favorites. Each document would mirror the shape of the objects below.
const DRILLS = [
  {
    id: '1',
    name: 'Soft Toss Hitting',
    skill: 'Hitting',
    ageGroups: ['T-Ball', 'Coach Pitch'],
    duration: '15 min',
    players: '2',
    difficulty: 'Beginner',
    objective: 'Develop proper swing mechanics and eye-hand coordination.',
    steps: [
      'Batter gets in stance 3 feet from partner',
      'Partner tosses ball underhand into hitting zone',
      'Batter focuses on level swing and follow-through',
      '10 swings then rotate',
    ],
  },
  {
    id: '2',
    name: 'Ground Ball Round Robin',
    skill: 'Fielding',
    ageGroups: ['Coach Pitch', 'Kid Pitch'],
    duration: '20 min',
    players: '6+',
    difficulty: 'Intermediate',
    objective: 'Improve fielding technique and footwork under the ball.',
    steps: [
      'Line players at shortstop position',
      'Coach hits/rolls ground balls one at a time',
      'Player fields, throws to first, goes to end of line',
      'Emphasize glove down, charge the ball',
    ],
  },
  {
    id: '3',
    name: 'Tee Work — Contact Point',
    skill: 'Hitting',
    ageGroups: ['T-Ball'],
    duration: '10 min',
    players: '1',
    difficulty: 'Beginner',
    objective: 'Learn proper contact point and stance width.',
    steps: [
      'Set tee at waist height',
      'Position batter with tee at front hip',
      'Focus on extension through the zone',
      '20 reps, adjust tee height each 5',
    ],
  },
  {
    id: '4',
    name: 'Relay Throw Drill',
    skill: 'Fielding',
    ageGroups: ['Kid Pitch'],
    duration: '15 min',
    players: '6+',
    difficulty: 'Intermediate',
    objective: 'Practice cut-off positioning and relay throws from the outfield.',
    steps: [
      'Place outfielder, shortstop cutoff, and catcher',
      'Coach hits to outfield',
      'Outfielder throws to cutoff',
      'Cutoff relays to catcher — timing is key',
    ],
  },
  {
    id: '5',
    name: 'Base Running — Read the Ball',
    skill: 'Base Running',
    ageGroups: ['Coach Pitch', 'Kid Pitch'],
    duration: '20 min',
    players: '4+',
    difficulty: 'Intermediate',
    objective: 'Teach smart base running decisions on contact.',
    steps: [
      'Runner on first',
      'Coach hits ball to different positions',
      'Runner must decide: advance or hold',
      'Discuss decision after each rep',
    ],
  },
  {
    id: '6',
    name: 'Pitching Mechanics — Windup',
    skill: 'Pitching',
    ageGroups: ['Kid Pitch'],
    duration: '15 min',
    players: '2',
    difficulty: 'Advanced',
    objective: 'Reinforce proper windup and weight transfer for velocity and control.',
    steps: [
      'Partner holds glove at strike zone height',
      'Pitcher focuses on: balance point, hip rotation, arm path, follow-through',
      '10 throws focusing on mechanics over speed',
      'Coach provides one cue per round',
    ],
  },
  {
    id: '7',
    name: 'Fly Ball Tracking',
    skill: 'Fielding',
    ageGroups: ['Coach Pitch', 'Kid Pitch'],
    duration: '15 min',
    players: '4+',
    difficulty: 'Intermediate',
    objective: 'Improve drop step and fly ball judgment.',
    steps: [
      'Players in outfield positions',
      'Coach hits/tosses fly balls in varying directions',
      'Players call "mine" and track ball',
      'Emphasize drop step on balls behind, charge on short flies',
    ],
  },
  {
    id: '8',
    name: 'Pick-Off Awareness',
    skill: 'Base Running',
    ageGroups: ['Kid Pitch'],
    duration: '10 min',
    players: '4+',
    difficulty: 'Advanced',
    objective: 'Teach leads, primary/secondary jumps, and pick-off reads.',
    steps: [
      'Runner takes lead off first base',
      'Pitcher in stretch, simulates pitch or pick-off throw',
      'Runner must read and react',
      'Rotate every 5 reps',
    ],
  },
];

const SKILLS = ['All', 'Hitting', 'Fielding', 'Pitching', 'Base Running'];
const AGE_GROUPS = ['All', 'T-Ball', 'Coach Pitch', 'Kid Pitch'];

const DIFFICULTY_COLORS: Record<string, string> = {
  Beginner: 'bg-green-100 text-green-700',
  Intermediate: 'bg-yellow-100 text-yellow-700',
  Advanced: 'bg-red-100 text-red-700',
};

const SKILL_COLORS: Record<string, string> = {
  Hitting: 'bg-blue-100 text-blue-700',
  Fielding: 'bg-purple-100 text-purple-700',
  Pitching: 'bg-orange-100 text-orange-700',
  'Base Running': 'bg-teal-100 text-teal-700',
};

export default function DrillsPage() {
  const [selectedSkill, setSelectedSkill] = useState('All');
  const [selectedAge, setSelectedAge] = useState('All');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = DRILLS.filter((d) => {
    const skillMatch = selectedSkill === 'All' || d.skill === selectedSkill;
    const ageMatch = selectedAge === 'All' || d.ageGroups.includes(selectedAge);
    return skillMatch && ageMatch;
  });

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 md:ml-64 p-4 md:p-8 pt-16 md:pt-8">
        <header className="mb-6">
          <h1 className="text-3xl font-bold font-headline">Practice Drill Library</h1>
          <p className="text-muted-foreground">Age-grouped baseball drills for every practice plan.</p>
        </header>

        <div className="mb-6 space-y-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Skill</p>
            <div className="flex flex-wrap gap-2">
              {SKILLS.map((skill) => (
                <Button
                  key={skill}
                  size="sm"
                  variant={selectedSkill === skill ? 'default' : 'outline'}
                  className="rounded-full"
                  onClick={() => setSelectedSkill(skill)}
                >
                  {skill}
                </Button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Age Group</p>
            <div className="flex flex-wrap gap-2">
              {AGE_GROUPS.map((age) => (
                <Button
                  key={age}
                  size="sm"
                  variant={selectedAge === age ? 'default' : 'outline'}
                  className="rounded-full"
                  onClick={() => setSelectedAge(age)}
                >
                  {age}
                </Button>
              ))}
            </div>
          </div>
        </div>

        {filtered.length === 0 ? (
          <Card className="border-none shadow-md py-12 text-center">
            <CardContent>
              <Dumbbell className="h-12 w-12 text-muted mx-auto mb-3" />
              <p className="text-muted-foreground">No drills match your filters. Try a different combination.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filtered.map((drill) => (
              <Card key={drill.id} className="border-none shadow-md overflow-hidden">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="font-headline text-base leading-tight">{drill.name}</CardTitle>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${DIFFICULTY_COLORS[drill.difficulty]}`}>
                      {drill.difficulty}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1 mt-1">
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${SKILL_COLORS[drill.skill]}`}>
                      {drill.skill}
                    </span>
                    {drill.ageGroups.map((ag) => (
                      <span key={ag} className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground">
                        {ag}
                      </span>
                    ))}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex gap-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {drill.duration}</span>
                    <span className="flex items-center gap-1"><Users className="h-3 w-3" /> {drill.players} players</span>
                  </div>
                  <p className="text-xs text-muted-foreground italic">{drill.objective}</p>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full justify-between h-8 text-xs rounded-lg bg-secondary/30 hover:bg-secondary/50"
                    onClick={() => setExpandedId(expandedId === drill.id ? null : drill.id)}
                  >
                    View Steps
                    {expandedId === drill.id ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  </Button>
                  {expandedId === drill.id && (
                    <ol className="space-y-1.5 pl-4 list-decimal">
                      {drill.steps.map((step, i) => (
                        <li key={i} className="text-xs text-foreground">{step}</li>
                      ))}
                    </ol>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
