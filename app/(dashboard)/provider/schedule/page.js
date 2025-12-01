'use client';

import { useState, useEffect } from 'react';
import { Calendar, Clock, Save, Loader2, Plus, X } from 'lucide-react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/use-toast';

const DAYS = [
  { id: 0, name: 'Sunday' },
  { id: 1, name: 'Monday' },
  { id: 2, name: 'Tuesday' },
  { id: 3, name: 'Wednesday' },
  { id: 4, name: 'Thursday' },
  { id: 5, name: 'Friday' },
  { id: 6, name: 'Saturday' }
];

export default function ProviderSchedulePage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [schedule, setSchedule] = useState([]);

  useEffect(() => {
    fetchSchedule();
  }, []);

  const fetchSchedule = async () => {
    try {
      const response = await api.get('/providers/me/schedule');
      if (response.data.success) {
        setSchedule(response.data.schedule || []);
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to load schedule',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const updateSchedule = (dayId, field, value) => {
    const existing = schedule.find(s => s.dayOfWeek === dayId);
    if (existing) {
      setSchedule(schedule.map(s => 
        s.dayOfWeek === dayId ? { ...s, [field]: value } : s
      ));
    } else {
      setSchedule([...schedule, {
        dayOfWeek: dayId,
        startTime: '09:00',
        endTime: '17:00',
        slotDurationMinutes: 30,
        bufferMinutes: 5,
        isAvailable: true,
        [field]: value
      }]);
    }
  };

  const toggleDay = (dayId) => {
    const existing = schedule.find(s => s.dayOfWeek === dayId);
    if (existing) {
      setSchedule(schedule.map(s => 
        s.dayOfWeek === dayId ? { ...s, isAvailable: !s.isAvailable } : s
      ));
    } else {
      setSchedule([...schedule, {
        dayOfWeek: dayId,
        startTime: '09:00',
        endTime: '17:00',
        slotDurationMinutes: 30,
        bufferMinutes: 5,
        isAvailable: true
      }]);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const response = await api.put('/providers/me/schedule', { schedule });
      if (response.data.success) {
        toast({
          title: 'Schedule Updated',
          description: 'Your schedule has been saved successfully'
        });
      }
    } catch (error) {
      toast({
        title: 'Update Failed',
        description: error.response?.data?.error || 'Failed to update schedule',
        variant: 'destructive'
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Calendar className="w-6 h-6 text-blue-500" />
            My Schedule
          </h1>
          <p className="text-slate-500 mt-1">Set your availability and appointment slots</p>
        </div>
        <Button onClick={handleSave} disabled={saving} className="bg-blue-500 hover:bg-blue-600">
          {saving ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
              Saving...
            </>
          ) : (
            <>
              <Save className="w-4 h-4 mr-2" />
              Save Schedule
            </>
          )}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Weekly Schedule</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {DAYS.map((day) => {
              const daySchedule = schedule.find(s => s.dayOfWeek === day.id);
              const isAvailable = daySchedule?.isAvailable || false;

              return (
                <div key={day.id} className="p-4 border rounded-lg">
                  <div className="flex items-center justify-between mb-4">
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isAvailable}
                        onChange={() => toggleDay(day.id)}
                        className="w-5 h-5 text-blue-600 rounded"
                      />
                      <span className="font-semibold text-slate-900">{day.name}</span>
                    </label>
                  </div>

                  {isAvailable && (
                    <div className="grid md:grid-cols-4 gap-4 mt-4">
                      <div>
                        <Label>Start Time</Label>
                        <Input
                          type="time"
                          value={daySchedule?.startTime || '09:00'}
                          onChange={(e) => updateSchedule(day.id, 'startTime', e.target.value)}
                          className="mt-1"
                        />
                      </div>
                      <div>
                        <Label>End Time</Label>
                        <Input
                          type="time"
                          value={daySchedule?.endTime || '17:00'}
                          onChange={(e) => updateSchedule(day.id, 'endTime', e.target.value)}
                          className="mt-1"
                        />
                      </div>
                      <div>
                        <Label>Slot Duration (min)</Label>
                        <Input
                          type="number"
                          value={daySchedule?.slotDurationMinutes || 30}
                          onChange={(e) => updateSchedule(day.id, 'slotDurationMinutes', parseInt(e.target.value))}
                          className="mt-1"
                          min={15}
                          max={120}
                          step={15}
                        />
                      </div>
                      <div>
                        <Label>Buffer (min)</Label>
                        <Input
                          type="number"
                          value={daySchedule?.bufferMinutes || 5}
                          onChange={(e) => updateSchedule(day.id, 'bufferMinutes', parseInt(e.target.value))}
                          className="mt-1"
                          min={0}
                          max={30}
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}



