import React from 'react';
export default function PlanningFormSection({title,description,icon:Icon,children,wide=false}) {
 return <section className={'planning-form-section'+(wide?' planning-form-section-wide':'')} aria-label={title}>
  <div className="planning-form-section-heading"><span className="planning-form-section-icon" aria-hidden="true"><Icon/></span><div><h3>{title}</h3><p>{description}</p></div></div>
  <div className="planning-form-section-fields">{children}</div>
 </section>;
}
