import { Icon, type IconName } from "../../../../shared/drawing/icons";

export type Feature = { icon: IconName; title: string; text: string };

/** An icon tile, a short bold title and one plain sentence per item. */
export function FeatureList({ items }: { items: Feature[] }) {
  return <ul className="feature-list">
    {items.map((item) => <li key={item.title}>
      <span className="feature-tile"><Icon name={item.icon} /></span>
      <div><h3>{item.title}</h3><p>{item.text}</p></div>
    </li>)}
  </ul>;
}
