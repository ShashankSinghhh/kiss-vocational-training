import { expect, type APIRequestContext, type APIResponse } from '@playwright/test';
import { ACCOUNTS, SEED_PASSWORD } from './helpers';

export async function token(request: APIRequestContext, email: string, password: string) {
  const res = await request.post('/api/v1/auth/login', { data: { email, password } });
  expect(res.ok()).toBeTruthy();
  return `Bearer ${((await res.json()) as { accessToken: string }).accessToken}`;
}

/**
 * Assigns a freshly created co-trainer to a batch. Test batches share the seeded trainer, and
 * many of them have sessions at the same times; with a second trainer either may teach, so
 * those are scheduling warnings, not hard clashes (T3).
 */
export async function addCoTrainer(request: APIRequestContext, batchId: string) {
  const admin = await token(request, ACCOUNTS.ADMIN, SEED_PASSWORD);
  const headers = { Authorization: admin };
  const s = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const fullName = `Co-trainer ${s}`;
  const created = await request.post('/api/v1/admin/users', {
    headers,
    data: {
      role: 'TRAINER',
      email: `e2e-cotrainer-${s}@kiss-vtmp.test`,
      fullName,
      password: 'E2e-Cotrain-Pass1',
      employeeCode: `CT-${s}`.slice(0, 40),
    },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const trainers = (await (
    await request.get('/api/v1/admin/trainers', { headers })
  ).json()) as Array<{
    id: string;
    fullName: string;
  }>;
  const trainerId = trainers.find((t) => t.fullName === fullName)!.id;
  const assigned = await request.post(`/api/v1/admin/batches/${batchId}/trainers`, {
    headers,
    data: { trainerId },
  });
  expect(assigned.ok(), await assigned.text()).toBeTruthy();
}

/**
 * Builds an isolated ACTIVE batch through the API: started a few days ago, two placed
 * students, the seeded trainer assigned, and one session that began an hour ago. Every test
 * batch has a session around now, so each also gets a co-trainer of its own: with two trainers
 * either may teach, and the seeded trainer's many test sessions are not a hard clash (T3).
 */
export async function setupActiveBatch(request: APIRequestContext) {
  const admin = await token(request, ACCOUNTS.ADMIN, SEED_PASSWORD);
  const h = { headers: { Authorization: admin } };
  const s = Date.now().toString(36);
  const day = (offset: number) =>
    new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
  const ok = async <T>(res: Promise<APIResponse>): Promise<T> => {
    const r = await res;
    expect(r.ok(), `${r.url()} → ${r.status()} ${await r.text()}`).toBeTruthy();
    return (r.status() === 204 ? undefined : await r.json()) as T;
  };

  const cycle = await ok<{ id: string }>(
    request.post('/api/v1/admin/cycles', {
      ...h,
      data: { name: `E2E training ${s}`, startsOn: day(-10), endsOn: day(60) },
    }),
  );
  const course = await ok<{ id: string; title: string }>(
    request.post('/api/v1/admin/courses', {
      ...h,
      data: {
        code: `TR-${s}`.slice(0, 20),
        title: `Plumbing ${s}`,
        description: 'Pipe fitting for e2e tests.',
        durationWeeks: 8,
        seatCapacity: 20,
      },
    }),
  );
  await ok(
    request.put(`/api/v1/admin/cycles/${cycle.id}/offerings/${course.id}`, {
      ...h,
      data: {
        enrollmentOpensAt: new Date(Date.now() - 3_600_000).toISOString(),
        enrollmentClosesAt: new Date(Date.now() + 86_400_000).toISOString(),
        isOpen: true,
      },
    }),
  );
  const batch = await ok<{ id: string }>(
    request.post('/api/v1/admin/batches', {
      ...h,
      data: {
        courseId: course.id,
        cycleId: cycle.id,
        name: 'Evening',
        capacity: 5,
        startDate: day(-5),
        endDate: day(50),
        venue: `Workshop C ${s}`,
      },
    }),
  );

  const students = [];
  for (let i = 0; i < 2; i++) {
    const student = {
      email: `e2e-train-${s}-${i}@kiss-vtmp.test`,
      password: 'E2e-Train-Pass1',
      fullName: `Trainee ${s} ${i}`,
    };
    await ok(
      request.post('/api/v1/admin/users', {
        ...h,
        data: { role: 'STUDENT', ...student, rollNo: `TR-${s}-${i}`, cgpa: 8 },
      }),
    );
    const auth = await token(request, student.email, student.password);
    const enrollment = await ok<{ id: string }>(
      request.post('/api/v1/enrollments', {
        headers: { Authorization: auth },
        data: { cycleId: cycle.id, courseIds: [course.id] },
      }),
    );
    await ok(request.post(`/api/v1/admin/enrollments/${enrollment.id}/approve`, h));
    await ok(
      request.post(`/api/v1/admin/batches/${batch.id}/students`, {
        ...h,
        data: { enrollmentId: enrollment.id },
      }),
    );
    students.push({ ...student, enrollmentId: enrollment.id });
  }

  const trainers = await ok<Array<{ id: string; fullName: string }>>(
    request.get('/api/v1/admin/trainers', h),
  );
  const trainer = trainers.find((t) => t.fullName === 'Sushant Mohanty')!;
  await ok(
    request.post(`/api/v1/admin/batches/${batch.id}/trainers`, {
      ...h,
      data: { trainerId: trainer.id },
    }),
  );
  await addCoTrainer(request, batch.id);
  await ok(
    request.post(`/api/v1/admin/batches/${batch.id}/sessions`, {
      ...h,
      data: {
        kind: 'single',
        startsAt: new Date(Date.now() - 3_600_000).toISOString(),
        endsAt: new Date(Date.now() + 3_600_000).toISOString(),
        topic: `Joints ${s}`,
      },
    }),
  );
  await ok(
    request.post(`/api/v1/admin/batches/${batch.id}/activate`, {
      headers: { ...h.headers, 'Idempotency-Key': `e2e-${s}` },
    }),
  );
  return { course, batch, students, adminAuth: admin };
}
