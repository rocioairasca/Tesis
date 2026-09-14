import React from 'react';
import Lotes from './Lotes';

// Preserve the existing route as an entry to the shared State filter.
export default function DisabledLotes() { return <Lotes initialState="disabled" />; }
