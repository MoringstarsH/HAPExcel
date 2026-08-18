import React, { useEffect, useState } from "react";

export function NumberDisplay({ presentation }) {
  if (!presentation?.formattedValue) return null;
  return <span className={`number-display ${presentation.percentage ? "number-percentage" : ""}`}>
    {presentation.prefix && <span className="number-prefix">{presentation.prefix}</span>}
    <span className="number-value">{presentation.formattedValue}</span>
    {presentation.suffix && <span className="number-suffix">{presentation.suffix}</span>}
  </span>;
}

export function EntityTags({ items, kind }) {
  if (!items.length) return null;
  return <span className="entity-tags">{items.map((item, index) => <span className={`entity-tag entity-${kind}`} key={`${item.id || item.name}-${index}`} title={item.name}>{item.name}</span>)}</span>;
}

function formatSize(size) {
  if (!size) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function AttachmentThumb({ item, onPreview }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [item.url]);
  return <button type="button" className={`attachment-chip ${item.image ? "attachment-image" : ""}`} title={[item.name, formatSize(item.size)].filter(Boolean).join(" · ")} disabled={!item.url} onPointerDown={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onPreview(item); }}>
    {item.image && item.url && !failed ? <img src={item.url} alt="" onError={() => setFailed(true)} /> : <span className="attachment-icon" aria-hidden="true">{item.image ? "图" : "附"}</span>}
    <span>{item.name}</span>
  </button>;
}

export function AttachmentDisplay({ items, onPreview }) {
  if (!items.length) return null;
  return <span className="attachment-list">{items.map((item, index) => <AttachmentThumb key={`${item.url || item.name}-${index}`} item={item} onPreview={onPreview} />)}{items.length > 1 && <span className="attachment-count">共 {items.length} 个</span>}</span>;
}

export function LocationDisplay({ value }) {
  if (!value) return null;
  return <span className="location-display" title={[value.name, value.address, value.lat && value.lng ? `${value.lat}, ${value.lng}` : ""].filter(Boolean).join("\n")}><span aria-hidden="true">⌖</span><span>{value.name || value.address}</span></span>;
}
