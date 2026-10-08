import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';

// Types mirror what the API returns (see GET /docs); dates arrive as ISO strings.
export const WORK_ORDER_STATUSES = [
  'OPEN',
  'ASSIGNED',
  'IN_PROGRESS',
  'COMPLETED',
] as const;
export type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number];
export type TechnicianStatus = 'AVAILABLE' | 'BUSY' | 'OFF_DUTY';
export type IneligibilityReason =
  'MISSING_SKILL' | 'NOT_AVAILABLE' | 'DIFFERENT_CITY';

export interface WorkOrder {
  id: number;
  title: string;
  description: string | null;
  city: string;
  requiredSkillCode: string;
  status: WorkOrderStatus;
  technician: { id: number; name: string } | null;
  createdAt: string;
  assignedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface Skill {
  code: string;
  name: string;
}

export interface TechnicianMatch {
  technician: {
    id: number;
    name: string;
    city: string;
    status: TechnicianStatus;
    skills: string[];
  };
  eligible: boolean;
  reasons: IneligibilityReason[];
}

export interface CreateWorkOrderRequest {
  title: string;
  description?: string;
  city: string;
  requiredSkill: string;
}

/**
 * Tags:
 * - WorkOrder/<id> and WorkOrder/LIST: one order, and every list query.
 * - Technician/LIST: anything that depends on technician availability (the matches).
 *
 * Lifecycle mutations invalidate their tags even when they fail, so a 409 caused by a
 * concurrent change refetches the current server state instead of leaving stale data.
 */
export const api = createApi({
  reducerPath: 'api',
  baseQuery: fetchBaseQuery({ baseUrl: '/api' }),
  tagTypes: ['WorkOrder', 'Technician'],
  endpoints: (build) => ({
    listWorkOrders: build.query<WorkOrder[], WorkOrderStatus | undefined>({
      query: (status) => ({
        url: '/work-orders',
        params: status && { status },
      }),
      providesTags: (result = []) => [
        { type: 'WorkOrder', id: 'LIST' },
        ...result.map(({ id }) => ({ type: 'WorkOrder' as const, id })),
      ],
    }),
    getWorkOrder: build.query<WorkOrder, number>({
      query: (id) => `/work-orders/${id}`,
      providesTags: (_result, _error, id) => [{ type: 'WorkOrder', id }],
    }),
    getTechnicianMatches: build.query<TechnicianMatch[], number>({
      query: (id) => `/work-orders/${id}/technician-matches`,
      providesTags: (_result, _error, id) => [
        { type: 'WorkOrder', id },
        { type: 'Technician', id: 'LIST' },
      ],
    }),
    listSkills: build.query<Skill[], void>({
      query: () => '/skills',
    }),
    createWorkOrder: build.mutation<WorkOrder, CreateWorkOrderRequest>({
      query: (body) => ({ url: '/work-orders', method: 'POST', body }),
      invalidatesTags: (result) =>
        result ? [{ type: 'WorkOrder', id: 'LIST' }] : [],
    }),
    assignWorkOrder: build.mutation<
      WorkOrder,
      { id: number; technicianId: number }
    >({
      query: ({ id, technicianId }) => ({
        url: `/work-orders/${id}/assign`,
        method: 'POST',
        body: { technicianId },
      }),
      // The technician becomes BUSY, which changes matches on every open work order.
      invalidatesTags: (_result, _error, { id }) => [
        { type: 'WorkOrder', id },
        { type: 'WorkOrder', id: 'LIST' },
        { type: 'Technician', id: 'LIST' },
      ],
    }),
    startWorkOrder: build.mutation<WorkOrder, number>({
      query: (id) => ({ url: `/work-orders/${id}/start`, method: 'POST' }),
      invalidatesTags: (_result, _error, id) => [
        { type: 'WorkOrder', id },
        { type: 'WorkOrder', id: 'LIST' },
      ],
    }),
    completeWorkOrder: build.mutation<WorkOrder, number>({
      query: (id) => ({ url: `/work-orders/${id}/complete`, method: 'POST' }),
      // The technician becomes AVAILABLE again.
      invalidatesTags: (_result, _error, id) => [
        { type: 'WorkOrder', id },
        { type: 'WorkOrder', id: 'LIST' },
        { type: 'Technician', id: 'LIST' },
      ],
    }),
  }),
});

export const {
  useListWorkOrdersQuery,
  useGetWorkOrderQuery,
  useGetTechnicianMatchesQuery,
  useListSkillsQuery,
  useCreateWorkOrderMutation,
  useAssignWorkOrderMutation,
  useStartWorkOrderMutation,
  useCompleteWorkOrderMutation,
} = api;
