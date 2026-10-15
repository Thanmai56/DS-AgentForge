// fixtures/po-processing-time.ts
// PO Processing Time fixture – drives MockPlanProvider and tests.

import type { LineageGraph } from '../src/core/model/types';

export const PO_PROCESSING_TIME_GRAPH: LineageGraph = {
  analyticModelId: 'AM_PO_APT',
  analyticModelLabel: 'PO Average Processing Time',

  sources: [
    {
      id: 'src-ZIPOHDRAPT',
      technicalName: 'ZIPOHDRAPT',
      label: 'PO Header Extract for APT',
      nodeType: 'source',
      fields: [
        { name: 'PURCHASEORDER', label: 'Purchase Order Number', type: 'cds.String', length: 10, key: true, notNull: true },
        { name: 'CREATIONDATE', label: 'Creation Date of Purchasing Document', type: 'cds.String', length: 8 },
        { name: 'COMPANYCODE', label: 'Company Code', type: 'cds.String', length: 4 },
        { name: 'PURCHASINGORGANIZATION', label: 'Purchasing Organization', type: 'cds.String', length: 4 },
        { name: 'PURCHASINGGROUP', label: 'Purchasing Group', type: 'cds.String', length: 3 },
        { name: 'SUPPLIER', label: 'Supplier', type: 'cds.String', length: 10 },
      ],
    },
    {
      id: 'src-ZIPOHISTEXT',
      technicalName: 'ZIPOHISTEXT',
      label: 'PO History Text Extract for APT',
      nodeType: 'source',
      fields: [
        { name: 'PURCHASEORDER', label: 'Purchasing Document Number', type: 'cds.String', length: 10, key: true, notNull: true },
        { name: 'PURCHASEORDERITEM', label: 'Item Number of Purchasing Document', type: 'cds.String', length: 5, key: true, notNull: true },
        { name: 'ACCOUNTASSIGNMENTNUMBER', label: 'Sequential Number of Account Assignment', type: 'cds.String', length: 2, key: true, notNull: true },
        { name: 'PURCHASINGHISTORYDOCUMENTTYPE', label: 'Transaction/event type, purchase order history', type: 'cds.String', length: 1, key: true, notNull: true },
        { name: 'DELIVERYDATE', label: 'Delivery Date', type: 'cds.String', length: 8 },
        { name: 'GOODSRECEIPTQUANTITY', label: 'Goods Receipt Quantity', type: 'cds.Decimal', precision: 13, scale: 3 },
      ],
    },
    {
      id: 'src-LFA1',
      technicalName: 'LFA1',
      label: 'Vendor Master (General Section)',
      nodeType: 'source',
      fields: [
        { name: 'LIFNR', label: 'Account Number of Vendor', type: 'cds.String', length: 10, key: true, notNull: true },
        { name: 'NAME1', label: 'Name 1', type: 'cds.String', length: 35 },
        { name: 'LAND1', label: 'Country Key', type: 'cds.String', length: 3 },
        { name: 'ORT01', label: 'City', type: 'cds.String', length: 35 },
      ],
    },
  ],

  views: [
    {
      id: 'view-V_PO_FINAL_DELIVERY_APT',
      technicalName: 'V_PO_FINAL_DELIVERY_APT',
      label: 'PO Final Delivery Date for APT',
      kind: 'intermediate',
      sources: ['ZIPOHISTEXT'],
      joins: [],
      projectedFields: [
        { name: 'PURCHASEORDER', label: 'Purchase Order Number', type: 'cds.String', length: 10, key: true, notNull: true },
        { name: 'FINAL_DELIVERY_DATE', label: 'Final Delivery Date', type: 'cds.String', length: 8 },
      ],
      calculatedFields: [],
      description: 'Derives the final (maximum) delivery date per purchase order from history records.',
      purpose: 'Provides the delivery date needed to compute PO processing time.',
    },
    {
      id: 'view-F_PO_PROCESSING_TIME_APT',
      technicalName: 'F_PO_PROCESSING_TIME_APT',
      label: 'PO Processing Time Fact APT',
      kind: 'fact',
      sources: ['ZIPOHDRAPT', 'V_PO_FINAL_DELIVERY_APT'],
      joins: [
        {
          leftSource: 'ZIPOHDRAPT',
          rightSource: 'V_PO_FINAL_DELIVERY_APT',
          leftField: 'PURCHASEORDER',
          rightField: 'PURCHASEORDER',
          joinType: 'inner',
        },
      ],
      projectedFields: [
        { name: 'PURCHASEORDER', label: 'Purchase Order Number', type: 'cds.String', length: 10, key: true, notNull: true },
        { name: 'CREATIONDATE', label: 'Creation Date of Purchasing Document', type: 'cds.String', length: 8 },
        { name: 'COMPANYCODE', label: 'Company Code', type: 'cds.String', length: 4 },
        { name: 'PURCHASINGORGANIZATION', label: 'Purchasing Organization', type: 'cds.String', length: 4 },
        { name: 'PURCHASINGGROUP', label: 'Purchasing Group', type: 'cds.String', length: 3 },
        { name: 'SUPPLIER', label: 'Supplier', type: 'cds.String', length: 10 },
        { name: 'FINAL_DELIVERY_DATE', label: 'Final Delivery Date', type: 'cds.String', length: 8 },
        { name: 'Order_Creation_Date', label: 'Order Creation Date', type: 'cds.Date' },
        { name: 'Order_Delivery_Date', label: 'Order Delivery Date', type: 'cds.Date' },
        { name: 'Total_Delivered_Order', label: 'Total Delivered Order', type: 'cds.Integer', isMeasure: true },
        { name: 'Processing_Days', label: 'Processing Days', type: 'cds.Integer', isMeasure: true },
      ],
      calculatedFields: [
        {
          name: 'Order_Creation_Date',
          label: 'Order Creation Date',
          type: 'cds.Date',
          formula: "TO_DATE(SUBSTRING(CREATIONDATE, 1, 4) || '-' || SUBSTRING(CREATIONDATE, 5, 2) || '-' || SUBSTRING(CREATIONDATE, 7, 2))",
        },
        {
          name: 'Order_Delivery_Date',
          label: 'Order Delivery Date',
          type: 'cds.Date',
          formula: "TO_DATE(SUBSTRING(FINAL_DELIVERY_DATE, 1, 4) || '-' || SUBSTRING(FINAL_DELIVERY_DATE, 5, 2) || '-' || SUBSTRING(FINAL_DELIVERY_DATE, 7, 2))",
        },
        {
          name: 'Processing_Days',
          label: 'Processing Days',
          type: 'cds.Integer',
          formula: 'DAYS_BETWEEN(Order_Creation_Date, Order_Delivery_Date) + 1',
        },
        {
          name: 'Total_Delivered_Order',
          label: 'Total Delivered Order',
          type: 'cds.Integer',
          formula: '1',
        },
      ],
      description: 'Fact view for PO processing time analysis.',
      purpose: 'Supports KPI reporting on purchase order processing efficiency.',
      tags: [{ key: 'PROCUREMENT', text: 'Procurement' }],
    },
  ],

  kpis: [
    {
      id: 'kpi-APT',
      name: 'APT',
      label: 'Average Processing Time',
      description: 'Average number of days between PO creation and final delivery.',
      formula: 'Processing_Days / Total_Delivered_Order',
      formulaState: 'unvalidated',
      targetView: 'F_PO_PROCESSING_TIME_APT',
    },
  ],
};
