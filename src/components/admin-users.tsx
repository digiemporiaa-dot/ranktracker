'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, Loader2, Plus, ShieldCheck, Trash2, UserMinus, UserPlus } from 'lucide-react';

import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatDateTime } from '@/lib/utils';

export type AdminUserRow = {
  id: string;
  email: string;
  name: string;
  role: string;
  isActive: boolean;
  isDemo: boolean;
  projectCount: number;
  createdAt: string;
  createdByEmail: string | null;
};

type DialogKind = 'create' | 'password' | 'delete' | null;

export function AdminUsers({
  rows,
  currentUserId,
}: {
  rows: AdminUserRow[];
  currentUserId: string;
}) {
  const router = useRouter();
  const toast = useToast();

  const [dialog, setDialog] = useState<DialogKind>(null);
  const [target, setTarget] = useState<AdminUserRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  // Create form
  const [form, setForm] = useState({ email: '', name: '', password: '' });
  // Password reset
  const [newPassword, setNewPassword] = useState('');
  // Delete
  const [typed, setTyped] = useState('');
  const [onDelete, setOnDelete] = useState<'reassign' | 'purge'>('reassign');
  const [recipientId, setRecipientId] = useState('');

  const recipients = rows.filter(
    (row) => row.isActive && row.id !== target?.id && row.id !== undefined,
  );

  function close() {
    setDialog(null);
    setTarget(null);
    setError(null);
    setForm({ email: '', name: '', password: '' });
    setNewPassword('');
    setTyped('');
    setOnDelete('reassign');
    setRecipientId('');
  }

  async function send(
    key: string,
    request: () => Promise<Response>,
    onSuccess: (data: Record<string, unknown>) => string,
  ) {
    setError(null);
    setPending(key);

    try {
      const response = await request();
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError((data.error as string) ?? 'That did not work. Please try again.');
        return false;
      }

      toast(onSuccess(data));
      close();
      router.refresh();
      return true;
    } catch {
      setError('We could not reach the server. Please try again.');
      return false;
    } finally {
      setPending(null);
    }
  }

  const createUser = () =>
    send(
      'create',
      () =>
        fetch('/api/admin/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        }),
      () => `Created ${form.email}`,
    );

  const setActive = (row: AdminUserRow, isActive: boolean) =>
    send(
      `active-${row.id}`,
      () =>
        fetch(`/api/admin/users/${row.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isActive }),
        }),
      () => (isActive ? `Reactivated ${row.email}` : `Deactivated ${row.email}`),
    );

  const resetPassword = () =>
    target &&
    send(
      'password',
      () =>
        fetch(`/api/admin/users/${target.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: newPassword }),
        }),
      () => `Password reset for ${target.email}. They have been signed out.`,
    );

  const deleteUser = () => {
    if (!target) return;
    const query =
      onDelete === 'reassign'
        ? `onDelete=reassign&toUserId=${encodeURIComponent(recipientId)}`
        : 'onDelete=purge';

    return send(
      'delete',
      () => fetch(`/api/admin/users/${target.id}?${query}`, { method: 'DELETE' }),
      (data) =>
        onDelete === 'reassign'
          ? `Deleted ${target.email}, moved ${data.projectsMoved} project(s)`
          : `Deleted ${target.email} and ${data.projectsPurged} project(s)`,
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button
          onClick={() => {
            close();
            setDialog('create');
          }}
        >
          <UserPlus className="h-4 w-4" />
          Add executive
        </Button>
      </div>

      {error && dialog === null ? <Alert tone="error">{error}</Alert> : null}

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Email</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Projects</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const isSelf = row.id === currentUserId;
              const isAdmin = row.role === 'SUPERADMIN';

              return (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">
                    <span className="flex items-center gap-2">
                      {row.email}
                      {isAdmin ? (
                        <Badge variant="default" className="gap-1">
                          <ShieldCheck className="h-3 w-3" />
                          Admin
                        </Badge>
                      ) : null}
                      {isSelf ? <Badge variant="outline">You</Badge> : null}
                      {row.isDemo ? <Badge variant="secondary">Demo</Badge> : null}
                    </span>
                    {row.createdByEmail ? (
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        Added by {row.createdByEmail}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{row.name}</TableCell>
                  <TableCell>
                    {row.isActive ? (
                      <Badge variant="success">Active</Badge>
                    ) : (
                      <Badge variant="destructive">Deactivated</Badge>
                    )}
                  </TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {row.projectCount}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatDateTime(row.createdAt)}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          close();
                          setTarget(row);
                          setDialog('password');
                        }}
                      >
                        <KeyRound className="h-3.5 w-3.5" />
                        Reset
                      </Button>

                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={isSelf || pending === `active-${row.id}`}
                        title={isSelf ? 'You cannot deactivate your own account' : undefined}
                        onClick={() => setActive(row, !row.isActive)}
                      >
                        {pending === `active-${row.id}` ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <UserMinus className="h-3.5 w-3.5" />
                        )}
                        {row.isActive ? 'Deactivate' : 'Reactivate'}
                      </Button>

                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                        disabled={isSelf}
                        title={isSelf ? 'You cannot delete your own account' : undefined}
                        onClick={() => {
                          close();
                          setTarget(row);
                          setOnDelete(row.projectCount > 0 ? 'reassign' : 'purge');
                          setDialog('delete');
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Delete
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <p className="text-sm text-muted-foreground">
        Deactivating is the usual way to remove someone: they are signed out immediately and
        cannot sign in again, but their projects and ranking history stay intact.
      </p>

      {/* ---------- create ---------- */}
      <Dialog open={dialog === 'create'} onOpenChange={(next) => (next ? null : close())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add an executive</DialogTitle>
            <DialogDescription>
              They will be able to manage their own projects, and will not see anyone else&apos;s.
            </DialogDescription>
          </DialogHeader>

          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void createUser();
            }}
          >
            {error ? <Alert tone="error">{error}</Alert> : null}

            <div className="space-y-1.5">
              <Label htmlFor="new-email">Email</Label>
              <Input
                id="new-email"
                type="email"
                value={form.email}
                onChange={(event) => setForm({ ...form, email: event.target.value })}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="new-name">Name</Label>
              <Input
                id="new-name"
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                required
                maxLength={100}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="new-password">Temporary password</Label>
              <Input
                id="new-password"
                type="text"
                value={form.password}
                onChange={(event) => setForm({ ...form, password: event.target.value })}
                required
                minLength={10}
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">
                At least 10 characters. Shown in plain text so you can pass it on — send it to
                them by a private channel and ask them to change it.
              </p>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={close} disabled={pending !== null}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending !== null}>
                {pending === 'create' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                Create account
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ---------- reset password ---------- */}
      <Dialog open={dialog === 'password'} onOpenChange={(next) => (next ? null : close())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset password</DialogTitle>
            <DialogDescription>
              Sets a new password for <strong className="text-foreground">{target?.email}</strong>{' '}
              and signs them out of every device.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {error ? <Alert tone="error">{error}</Alert> : null}
            <div className="space-y-1.5">
              <Label htmlFor="reset-password">New password</Label>
              <Input
                id="reset-password"
                type="text"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                minLength={10}
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">At least 10 characters.</p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={close} disabled={pending !== null}>
              Cancel
            </Button>
            <Button
              onClick={() => void resetPassword()}
              disabled={pending !== null || newPassword.length < 10}
            >
              {pending === 'password' ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Reset password
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------- delete ---------- */}
      <Dialog open={dialog === 'delete'} onOpenChange={(next) => (next ? null : close())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {target?.email}?</DialogTitle>
            <DialogDescription>
              {target?.projectCount
                ? `This account owns ${target.projectCount} project(s). Choose what happens to them — this cannot be undone.`
                : 'This account owns no projects. Deleting it cannot be undone.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {error ? <Alert tone="error">{error}</Alert> : null}

            {target?.projectCount ? (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="on-delete">Their projects</Label>
                  <Select
                    id="on-delete"
                    value={onDelete}
                    onChange={(event) =>
                      setOnDelete(event.target.value as 'reassign' | 'purge')
                    }
                  >
                    <option value="reassign">Move them to someone else</option>
                    <option value="purge">Delete them and all their ranking history</option>
                  </Select>
                </div>

                {onDelete === 'reassign' ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="recipient">Move to</Label>
                    <Select
                      id="recipient"
                      value={recipientId}
                      onChange={(event) => setRecipientId(event.target.value)}
                    >
                      <option value="">Choose an account…</option>
                      {recipients.map((row) => (
                        <option key={row.id} value={row.id}>
                          {row.email}
                        </option>
                      ))}
                    </Select>
                  </div>
                ) : (
                  <Alert tone="error">
                    Every project, keyword and recorded position belonging to this account will be
                    deleted permanently.
                  </Alert>
                )}
              </div>
            ) : null}

            <div className="space-y-1.5">
              <Label htmlFor="delete-user-confirm">
                Type <span className="font-mono text-foreground">{target?.email}</span> to confirm
              </Label>
              <Input
                id="delete-user-confirm"
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                autoComplete="off"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={close} disabled={pending !== null}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void deleteUser()}
              disabled={
                pending !== null ||
                typed !== target?.email ||
                (onDelete === 'reassign' && Boolean(target?.projectCount) && !recipientId)
              }
            >
              {pending === 'delete' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              Delete account
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
