import React from 'react';
// The option label stays a plain display name after selection. Email only disambiguates the dropdown.
export function renderUserOption(option){
 return <div><div>{option.label}</div>{option.data.email && option.data.email!==option.label && <div className="gs-ui-helper">{option.data.email}</div>}</div>;
}
