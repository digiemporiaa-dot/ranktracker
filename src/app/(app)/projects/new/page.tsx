import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/page-header';
import { ProjectForm } from '@/components/project-form';

export const metadata = { title: 'New project · OurRankTracker' };

export const dynamic = 'force-dynamic';

export default function NewProjectPage() {
  return (
    <>
      <PageHeader title="Create project" description="Track a website's Google rankings." />
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Project details</CardTitle>
          <CardDescription>
            These settings become the defaults for every keyword you add.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ProjectForm />
        </CardContent>
      </Card>
    </>
  );
}
