'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Loader2 } from 'lucide-react';

interface MaintenanceCardProps {
  title: string;
  description: string;
  inputLabel?: string;
  inputPlaceholder?: string;
  inputValue?: string;
  onInputChange?: (val: string) => void;
  buttonLabel: string;
  buttonVariant?: 'destructive' | 'default';
  confirmMessage?: string;
  onExecute: () => Promise<void>;
  disabled?: boolean;
}

export function MaintenanceCard({
  title,
  description,
  inputLabel,
  inputPlaceholder,
  inputValue,
  onInputChange,
  buttonLabel,
  buttonVariant = 'destructive',
  confirmMessage = 'Warning: This action is permanent. Are you sure you want to proceed?',
  onExecute,
  disabled = false,
}: MaintenanceCardProps) {
  const [loading, setLoading] = useState(false);

  const handleConfirm = async () => {
    setLoading(true);
    try {
      await onExecute();
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="border-none shadow-md">
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {inputLabel && onInputChange && (
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">{inputLabel}</Label>
            <Input
              placeholder={inputPlaceholder}
              value={inputValue ?? ''}
              onChange={(e) => onInputChange(e.target.value)}
              type="email"
              className="max-w-sm"
            />
          </div>
        )}
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant={buttonVariant} disabled={disabled || loading} size="sm">
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  Running…
                </>
              ) : (
                buttonLabel
              )}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Are you sure?</AlertDialogTitle>
              <AlertDialogDescription>{confirmMessage}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleConfirm}
                className={
                  buttonVariant === 'destructive'
                    ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                    : ''
                }
              >
                Confirm
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
