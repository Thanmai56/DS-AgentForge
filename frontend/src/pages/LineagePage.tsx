// src/pages/LineagePage.tsx
// Displays the end-to-end SAP Datasphere Semantic Data Lineage matching Screenshot 5.
// Clicking any node displays its column definitions and view lineage.

import React from 'react';
import { DatasphereLineageView } from '../components/lineage/DatasphereLineageView';

export const LineagePage: React.FC = () => {
  return (
    <div className="h-full w-full flex flex-col bg-[#F8FAFC]">
      <DatasphereLineageView />
    </div>
  );
};
