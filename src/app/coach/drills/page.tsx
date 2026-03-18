"use client";

import { useState } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { generateCustomPracticeDrills, type GenerateCustomPracticeDrillsOutput } from '@/ai/flows/generate-custom-practice-drills';
import { Loader2, Dumbbell, Clock, Zap, Info } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

export default function DrillsPage() {
  const [ageGroup, setAgeGroup] = useState('');
  const [skillLevel, setSkillLevel] = useState('');
  const [practiceFocus, setPracticeFocus] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<GenerateCustomPracticeDrillsOutput | null>(null);

  const handleGenerate = async () => {
    if (!ageGroup || !skillLevel || !practiceFocus) return;
    setLoading(true);
    try {
      const data = await generateCustomPracticeDrills({
        ageGroup,
        skillLevel,
        practiceFocus,
      });
      setResults(data);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar role="coach" />
      <main className="flex-1 ml-64 p-8">
        <header className="mb-8">
          <h1 className="text-3xl font-bold font-headline">AI Practice Drill Generator</h1>
          <p className="text-muted-foreground">Let AI help you design the perfect practice session for your team.</p>
        </header>

        <div className="grid gap-8 lg:grid-cols-3">
          <Card className="lg:col-span-1 border-none shadow-lg h-fit">
            <CardHeader>
              <CardTitle className="font-headline">Session Parameters</CardTitle>
              <CardDescription>Select your team details</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label>Age Group</Label>
                <Select onValueChange={setAgeGroup} value={ageGroup}>
                  <SelectTrigger className="rounded-xl">
                    <SelectValue placeholder="Select Age" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="U6 (T-Ball)">U6 (T-Ball)</SelectItem>
                    <SelectItem value="U8 (Coach Pitch)">U8 (Coach Pitch)</SelectItem>
                    <SelectItem value="U10 (Minors)">U10 (Minors)</SelectItem>
                    <SelectItem value="U12 (Majors)">U12 (Majors)</SelectItem>
                    <SelectItem value="High School">High School</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Skill Level</Label>
                <Select onValueChange={setSkillLevel} value={skillLevel}>
                  <SelectTrigger className="rounded-xl">
                    <SelectValue placeholder="Select Level" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Beginner">Beginner</SelectItem>
                    <SelectItem value="Intermediate">Intermediate</SelectItem>
                    <SelectItem value="Advanced">Advanced</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Practice Focus</Label>
                <Select onValueChange={setPracticeFocus} value={practiceFocus}>
                  <SelectTrigger className="rounded-xl">
                    <SelectValue placeholder="Select Focus" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Dribbling">Dribbling</SelectItem>
                    <SelectItem value="Passing">Passing</SelectItem>
                    <SelectItem value="Shooting">Shooting</SelectItem>
                    <SelectItem value="Fielding">Fielding</SelectItem>
                    <SelectItem value="Baserunning">Baserunning</SelectItem>
                    <SelectItem value="Teamwork">Teamwork</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Button
                className="w-full h-12 rounded-xl text-lg font-semibold"
                disabled={loading || !ageGroup || !skillLevel || !practiceFocus}
                onClick={handleGenerate}
              >
                {loading ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Zap className="mr-2 h-5 w-5" />}
                Generate Drills
              </Button>
            </CardContent>
          </Card>

          <div className="lg:col-span-2 space-y-6">
            {!results && !loading && (
              <div className="flex flex-col items-center justify-center py-24 text-center bg-white rounded-2xl border border-dashed border-primary/20">
                <Dumbbell className="h-16 w-16 text-primary/20 mb-4" />
                <h2 className="text-xl font-bold font-headline text-muted-foreground">Ready to Plan?</h2>
                <p className="max-w-md text-muted-foreground mt-2 px-4">Fill out the parameters on the left to receive customized drill suggestions powered by AI.</p>
              </div>
            )}

            {loading && (
              <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                  <Card key={i} className="animate-pulse border-none shadow-md">
                    <div className="h-40 bg-muted rounded-2xl" />
                  </Card>
                ))}
              </div>
            )}

            {results && results.drillSuggestions.map((drill, idx) => (
              <Card key={idx} className="border-none shadow-lg overflow-hidden group">
                <CardHeader className="bg-primary text-primary-foreground">
                  <div className="flex justify-between items-start">
                    <div>
                      <CardTitle className="text-xl font-headline font-bold">{drill.name}</CardTitle>
                      <div className="flex gap-2 mt-2">
                        <Badge variant="secondary" className="bg-white/20 text-white border-none">
                          <Clock className="mr-1 h-3 w-3" /> {drill.durationMinutes} mins
                        </Badge>
                        <Badge variant="secondary" className="bg-white/20 text-white border-none">
                          <Zap className="mr-1 h-3 w-3" /> {drill.intensity} Intensity
                        </Badge>
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-6 space-y-4">
                  <div>
                    <h4 className="font-bold flex items-center gap-2 mb-2 text-primary">
                      <Info className="h-4 w-4" /> Instructions
                    </h4>
                    <p className="text-muted-foreground leading-relaxed">{drill.description}</p>
                  </div>
                  <div>
                    <h4 className="font-bold mb-2 text-primary">Required Equipment</h4>
                    <div className="flex flex-wrap gap-2">
                      {drill.equipment.map((item, i) => (
                        <Badge key={i} variant="outline" className="border-primary/20 text-primary">{item}</Badge>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}