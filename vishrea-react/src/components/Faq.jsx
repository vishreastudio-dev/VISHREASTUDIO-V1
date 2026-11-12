import React from 'react';

/** Native disclosure list: keyboard and screen-reader friendly without extra scripting. */
export const Faq = ({ items, headingLevel = 3 }) => {
  const H = `h${headingLevel}`;
  return (
    <div className="faq">
      {items.map((f) => (
        <details key={f.q}>
          <summary>
            <H>{f.q}</H>
          </summary>
          <p>{f.a}</p>
        </details>
      ))}
    </div>
  );
};
