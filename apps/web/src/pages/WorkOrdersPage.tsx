import type { ChangeEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  useListWorkOrdersQuery,
  useSkillName,
  WORK_ORDER_STATUSES,
} from '../api';
import { toApiError } from '../api-errors';
import { CreateWorkOrderForm } from '../components/CreateWorkOrderForm';
import { StatusBadge } from '../components/StatusBadge';
import { formatDateTime, parseStatus, STATUS_LABELS } from '../format';

export function WorkOrdersPage() {
  // The URL owns the filter, so a refreshed or shared link shows the same list.
  const [searchParams, setSearchParams] = useSearchParams();
  const status = parseStatus(searchParams.get('status'));
  // currentData belongs to the current filter only; `data` would keep showing the previous
  // filter's rows while the new list loads.
  const {
    currentData: workOrders,
    isFetching,
    error,
    refetch,
  } = useListWorkOrdersQuery(status);
  const skillName = useSkillName();

  function handleStatusChange(event: ChangeEvent<HTMLSelectElement>) {
    const value = event.target.value;
    setSearchParams(value ? { status: value } : {});
  }

  return (
    <div className="two-column">
      <section aria-labelledby="work-orders-heading">
        <div className="section-header">
          <h1 id="work-orders-heading">
            Work orders
            {workOrders && <span className="count">{workOrders.length}</span>}
          </h1>
          <div className="inline-field">
            <label htmlFor="status-filter">Status</label>
            <select
              id="status-filter"
              value={status ?? ''}
              onChange={handleStatusChange}
            >
              <option value="">All</option>
              {WORK_ORDER_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
        </div>

        {!workOrders && isFetching ? (
          <p className="muted">Loading work orders…</p>
        ) : error ? (
          <div className="form-error" role="alert">
            <p>{toApiError(error).messages.join(' ')}</p>
            <button type="button" onClick={() => void refetch()}>
              Try again
            </button>
          </div>
        ) : !workOrders?.length ? (
          <p className="empty">
            {status
              ? `No work orders with status ${STATUS_LABELS[status]}.`
              : 'No work orders yet. Create the first one.'}
          </p>
        ) : (
          <div className="table-wrap card">
            <table className="work-orders" aria-busy={isFetching}>
              <thead>
                <tr>
                  <th scope="col">Work order</th>
                  <th scope="col">City</th>
                  <th scope="col">Skill</th>
                  <th scope="col">Status</th>
                  <th scope="col">Created</th>
                </tr>
              </thead>
              <tbody>
                {workOrders.map((workOrder) => (
                  <tr key={workOrder.id}>
                    <td>
                      <Link
                        className="title-link"
                        to={`/work-orders/${workOrder.id}`}
                      >
                        {workOrder.title}
                      </Link>
                      <span className="id"> #{workOrder.id}</span>
                    </td>
                    <td>{workOrder.city}</td>
                    <td>{skillName(workOrder.requiredSkillCode)}</td>
                    <td>
                      <StatusBadge status={workOrder.status} />
                    </td>
                    <td className="muted">
                      <time dateTime={workOrder.createdAt}>
                        {formatDateTime(workOrder.createdAt)}
                      </time>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <aside className="card" aria-labelledby="create-heading">
        <h2 id="create-heading">New work order</h2>
        <CreateWorkOrderForm />
      </aside>
    </div>
  );
}
