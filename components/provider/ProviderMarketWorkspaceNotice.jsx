import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function ProviderMarketWorkspaceNotice({
  eyebrow = 'Nigeria provider workspace',
  title,
  description,
  icon: Icon,
  primaryAction,
  secondaryAction,
}) {
  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium text-emerald-600">{eyebrow}</p>
        <h1 className="mt-2 text-3xl font-bold text-foreground">{title}</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{description}</p>
      </div>

      <Card className="border-emerald-200 bg-emerald-50/70 dark:border-emerald-900 dark:bg-emerald-950/20">
        <CardContent className="flex items-start gap-4 p-5">
          <div className="rounded-2xl bg-emerald-600 p-3 text-white">
            <Icon className="h-5 w-5" />
          </div>
          <div className="space-y-2">
            <p className="font-medium text-emerald-950 dark:text-emerald-100">
              Nigeria providers see only market-ready workflows.
            </p>
            <p className="text-sm text-emerald-900/80 dark:text-emerald-100/80">
              US-specific operational modules stay hidden here so clinicians, hospital teams, and pharmacies only work with the live Nigeria care flow.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        {primaryAction ? (
          <Card>
            <CardHeader>
              <CardTitle>{primaryAction.title}</CardTitle>
              <CardDescription>{primaryAction.description}</CardDescription>
            </CardHeader>
            <CardContent>
              <Link href={primaryAction.href}>
                <Button className="w-full bg-emerald-600 hover:bg-emerald-700">
                  {primaryAction.label}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
            </CardContent>
          </Card>
        ) : null}

        {secondaryAction ? (
          <Card>
            <CardHeader>
              <CardTitle>{secondaryAction.title}</CardTitle>
              <CardDescription>{secondaryAction.description}</CardDescription>
            </CardHeader>
            <CardContent>
              <Link href={secondaryAction.href}>
                <Button variant="outline" className="w-full">
                  {secondaryAction.label}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
