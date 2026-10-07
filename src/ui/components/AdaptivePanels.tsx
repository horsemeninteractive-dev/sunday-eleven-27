import { useState, type ReactNode } from 'react';
import { Dialog } from '../dialogs/Dialog';
import { Button } from './primitives';

export interface WorkspacePanel {
  id: string;
  label: string;
  content: ReactNode;
  wide?: boolean;
}
interface Layout { order: string[]; hidden: string[] }

/** Browser-local presentation only: never included in a career or save schema. */
export function readPanelLayout(value: string | null, ids: string[]): Layout {
  try {
    const parsed: unknown = value ? JSON.parse(value) : null;
    if (!parsed || typeof parsed !== 'object') return { order: ids, hidden: [] };
    const layout = parsed as Partial<Layout>;
    const order = Array.isArray(layout.order) ? layout.order.filter((id): id is string => typeof id === 'string' && ids.includes(id)) : [];
    const hidden = Array.isArray(layout.hidden) ? layout.hidden.filter((id): id is string => typeof id === 'string' && ids.includes(id)) : [];
    return { order: [...new Set([...order, ...ids])], hidden: [...new Set(hidden)] };
  } catch {
    return { order: ids, hidden: [] };
  }
}

export function AdaptivePanels({ name, panels }: { name: string; panels: WorkspacePanel[] }) {
  const ids = panels.map(panel => panel.id);
  const key = `se27.ui.panels.${name}`;
  const [layout, setLayout] = useState<Layout>(() => {
    try { return readPanelLayout(localStorage.getItem(key), ids); }
    catch { return readPanelLayout(null, ids); }
  });
  const [editing, setEditing] = useState(false);
  const [storageFailed, setStorageFailed] = useState(false);
  const current = readPanelLayout(JSON.stringify(layout), ids);
  const save = (next: Layout) => {
    setLayout(next);
    try { localStorage.setItem(key, JSON.stringify(next)); setStorageFailed(false); }
    catch { setStorageFailed(true); }
  };
  const move = (index: number, delta: number) => {
    const order = [...current.order];
    [order[index], order[index + delta]] = [order[index + delta]!, order[index]!];
    save({ ...current, order });
  };
  return <div className="adaptive-workspace">
    <div className="workspace-toolbar">
      <span className="small muted">Your {name} workspace</span>
      <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>Customise panels</Button>
    </div>
    {storageFailed && <p className="small tone tone--warn" role="status">This layout works for this visit, but browser storage could not remember it.</p>}
    <div className="adaptive-panels">
      {current.order.filter(id => !current.hidden.includes(id)).map(id => {
        const panel = panels.find(item => item.id === id)!;
        return <div key={id} className={`adaptive-panels__slot${panel.wide ? ' adaptive-panels__slot--wide' : ''}`} data-panel={id}>{panel.content}</div>;
      })}
    </div>
    {current.hidden.length === ids.length && <p className="empty">All optional panels are hidden. Customise panels to bring them back.</p>}
    {editing && <Dialog title={`Customise ${name} panels`} narrow onClose={() => setEditing(false)} footer={<><Button variant="ghost" onClick={() => save({ order: ids, hidden: [] })}>Restore default layout</Button><Button variant="primary" onClick={() => setEditing(false)}>Done</Button></>}>
      <p className="small muted">Choose what to see and its reading order. Wide screens arrange panels side by side; smaller screens follow this order. Your choices stay in this browser, separate from your saves.</p>
      <ul className="panel-picker">
        {current.order.map((id, index) => <li key={id}>
          <label><input type="checkbox" checked={!current.hidden.includes(id)} onChange={() => save({ ...current, hidden: current.hidden.includes(id) ? current.hidden.filter(item => item !== id) : [...current.hidden, id] })} />{panels.find(panel => panel.id === id)!.label}</label>
          <div className="row row--tight"><Button variant="ghost" size="sm" disabled={index === 0} ariaLabel={`Move ${panels.find(panel => panel.id === id)!.label} earlier`} onClick={() => move(index, -1)}>↑</Button><Button variant="ghost" size="sm" disabled={index === ids.length - 1} ariaLabel={`Move ${panels.find(panel => panel.id === id)!.label} later`} onClick={() => move(index, 1)}>↓</Button></div>
        </li>)}
      </ul>
    </Dialog>}
  </div>;
}
