---
name: "dsp-model-creator"
description: "Creates SAP Datasphere models including local tables, views, and other modeling objects. Invoke when user wants to create DSP models or needs guidance on model creation."
---

# SAP Datasphere Model Creator

This skill helps you create various SAP Datasphere models using the `@sap/datasphere-cli` tool, including local tables, views, and other modeling objects.

## Prerequisites

1. **Installed @sap/datasphere-cli**:
   ```bash
   npm install @sap/datasphere-cli
   ```

2. **SAP Datasphere Tenant**:
   - Access to a SAP Datasphere tenant
   - Valid passcode or OAuth credentials

## Usage

### 1. Create Local Table

#### Step 1: Prepare JSON Definition File

Create a JSON file with the following structure:

```json
{
  "definitions": {
    "TABLE_NAME": {
      "kind": "entity",
      "elements": {
        "COLUMN1": {
          "@EndUserText.label": "Column 1",
          "type": "cds.Integer",
          "key": true,
          "notNull": true
        },
        "COLUMN2": {
          "@EndUserText.label": "Column 2",
          "type": "cds.String",
          "length": 100,
          "notNull": true
        }
      },
      "@EndUserText.label": "Table Label"
    }
  }
}
```

#### Step 2: Execute Create Command

```bash
datasphere objects local-tables create --file-path <definition-file.json> --space <space-name> --host <tenant-url>
```

### 2. Create View

#### Step 1: Prepare JSON Definition File

Create a JSON file with the following structure, based on the observed view structure:

```json
{
  "definitions": {
    "VIEW_NAME": {
      "kind": "entity",
      "elements": {
        "COLUMN1": {
          "@EndUserText.label": "Column 1 Label",
          "type": "cds.String",
          "length": 100,
          "notNull": true
        },
        "COLUMN2": {
          "@EndUserText.label": "Column 2 Label",
          "type": "cds.Decimal",
          "precision": 31,
          "scale": 10
        }
      },
      "query": {
        "SELECT": {
          "from": {
            "ref": [
              "SOURCE_TABLE"
            ],
            "as": "ST"
          },
          "columns": [
            {
              "ref": [
                "ST",
                "SOURCE_COLUMN1"
              ]
            },
            {
              "ref": [
                "ST",
                "SOURCE_COLUMN2"
              ]
            }
          ],
          "where": [
            {
              "ref": [
                "ST",
                "SOURCE_COLUMN1"
              ]
            },
            "=",
            {
              "val": "some value"
            }
          ]
        }
      },
      "@EndUserText.label": "View Label",
      "@DataWarehouse.businessDefinition.description": "View description",
      "@DataWarehouse.businessDefinition.purpose": "View purpose",
      "@DataWarehouse.businessDefinition.tags": [
        {
          "key": "TAG1",
          "text": "Tag 1"
        }
      ],
      "@ObjectModel.modelingPattern": {
        "#": "DATA_STRUCTURE"
      },
      "@ObjectModel.supportedCapabilities": [
        {
          "#": "DATA_STRUCTURE"
        }
      ]
    }
  }
}
```

#### Step 2: Execute Create Command

```bash
datasphere objects views create --file-path <definition-file.json> --space <space-name> --host <tenant-url>
```

### 3. Create Other Models

Similar steps apply for creating other modeling objects:

- **Analytic Models**:
  ```bash
  datasphere objects analytic-models create --file-path <definition-file.json> --space <space-name> --host <tenant-url>
  ```

- **Data Flows**:
  ```bash
  datasphere objects data-flows create --file-path <definition-file.json> --space <space-name> --host <tenant-url>
  ```

- **Replication Flows**:
  ```bash
  datasphere objects replication-flows create --file-path <definition-file.json> --space <space-name> --host <tenant-url>
  ```

- **Transformation Flows**:
  ```bash
  datasphere objects transformation-flows create --file-path <definition-file.json> --space <space-name> --host <tenant-url>
  ```

## Authentication

### Using Passcode

1. **Get Passcode URL**:
   ```bash
   datasphere config passcode-url --host <tenant-url>
   ```

2. **Access the URL**:
   - Open the returned URL in a browser
   - Log in and copy the passcode

3. **Use Passcode**:
   - The CLI will prompt you for the passcode when executing commands

### Using OAuth

1. **Login**:
   ```bash
   datasphere login --host <tenant-url> --authorization-flow authorization_code
   ```

2. **Provide Credentials**:
   - Client ID
   - Client Secret
   - Authorization URL
   - Token URL

## Examples

### Example 1: Create Local Table

1. **Create definition file** (`local-table.json`):
   ```json
   {
     "definitions": {
       "CUSTOMER_TABLE": {
         "kind": "entity",
         "elements": {
           "CUSTOMER_ID": {
             "@EndUserText.label": "Customer ID",
             "type": "cds.Integer",
             "key": true,
             "notNull": true
           },
           "CUSTOMER_NAME": {
             "@EndUserText.label": "Customer Name",
             "type": "cds.String",
             "length": 200,
             "notNull": true
           },
           "CREATED_DATE": {
             "@EndUserText.label": "Created Date",
             "type": "cds.Date",
             "notNull": true
           }
         },
         "@EndUserText.label": "Customer Table"
       }
     }
   }
   ```

2. **Execute command**:
   ```bash
   datasphere objects local-tables create --file-path local-table.json --space SAP_SCT --host https://dwc-field-training.eu10.hcs.cloud.sap
   ```

### Example 2: Create Simple View

1. **Create definition file** (`simple-view.json`):
   ```json
   {
     "definitions": {
       "SIMPLE_VIEW": {
         "kind": "entity",
         "elements": {
           "ID": {
             "@EndUserText.label": "ID",
             "type": "cds.Integer",
             "notNull": true
           },
           "NAME": {
             "@EndUserText.label": "Name",
             "type": "cds.String",
             "length": 100
           }
         },
         "query": {
           "SELECT": {
             "from": {
               "ref": [
                 "TEST_LOCAL_TABLE"
               ],
               "as": "T"
             },
             "columns": [
               {
                 "ref": [
                   "T",
                   "ID"
                 ]
               },
               {
                 "ref": [
                   "T",
                   "NAME"
                 ]
               }
             ]
           }
         },
         "@EndUserText.label": "Simple View",
         "@DataWarehouse.businessDefinition.description": "A simple view example",
         "@DataWarehouse.businessDefinition.purpose": "Demonstrate view creation",
         "@ObjectModel.modelingPattern": {
           "#": "DATA_STRUCTURE"
         },
         "@ObjectModel.supportedCapabilities": [
           {
             "#": "DATA_STRUCTURE"
           }
         ]
       }
     }
   }
   ```

2. **Execute command**:
   ```bash
   datasphere objects views create --file-path simple-view.json --space SAP_SCT --host https://dwc-field-training.eu10.hcs.cloud.sap
   ```

### Example 3: Create View with Join

1. **Create definition file** (`join-view.json`):
   ```json
   {
     "definitions": {
       "JOIN_VIEW": {
         "kind": "entity",
         "elements": {
           "USER_ID": {
             "@EndUserText.label": "User ID",
             "type": "cds.Integer",
             "notNull": true
           },
           "USER_NAME": {
             "@EndUserText.label": "User Name",
             "type": "cds.String",
             "length": 100
           },
           "EMAIL": {
             "@EndUserText.label": "Email",
             "type": "cds.String",
             "length": 200
           }
         },
         "query": {
           "SELECT": {
             "from": {
               "join": "inner",
               "args": [
                 {
                   "ref": [
                     "USER_INFO_TABLE"
                   ],
                   "as": "U"
                 },
                 {
                   "ref": [
                     "TEST_LOCAL_TABLE"
                   ],
                   "as": "T"
                 }
               ],
               "on": [
                 {
                   "ref": [
                     "U",
                     "USER_ID"
                   ]
                 },
                 "=",
                 {
                   "ref": [
                     "T",
                     "ID"
                   ]
                 }
               ]
             },
             "columns": [
               {
                 "ref": [
                   "U",
                   "USER_ID"
                 ]
               },
               {
                 "ref": [
                   "U",
                   "USER_NAME"
                 ]
               },
               {
                 "ref": [
                   "U",
                   "EMAIL"
                 ]
               }
             ]
           }
         },
         "@EndUserText.label": "Join View",
         "@DataWarehouse.businessDefinition.description": "A view with join example",
         "@DataWarehouse.businessDefinition.purpose": "Demonstrate join in views",
         "@ObjectModel.modelingPattern": {
           "#": "DATA_STRUCTURE"
         },
         "@ObjectModel.supportedCapabilities": [
           {
             "#": "DATA_STRUCTURE"
           }
         ]
       }
     }
   }
   ```

2. **Execute command**:
   ```bash
   datasphere objects views create --file-path join-view.json --space SAP_SCT --host https://dwc-field-training.eu10.hcs.cloud.sap
   ```

### Example 4: List Existing Models

```bash
datasphere objects local-tables list --space SAP_SCT --host https://dwc-field-training.eu10.hcs.cloud.sap
```

### Example 5: Read Model Definition

```bash
datasphere objects local-tables read --name CUSTOMER_TABLE --space SAP_SCT --host https://dwc-field-training.eu10.hcs.cloud.sap
```

## Troubleshooting

1. **Passcode Expired**:
   - Get a new passcode from the passcode URL

2. **JSON Format Error**:
   - Validate JSON syntax
   - Ensure proper CDS format is used

3. **Permission Denied**:
   - Check if you have sufficient permissions in the specified space

4. **Model Already Exists**:
   - Use `update` command instead of `create`

5. **Invalid Source Table**:
   - Ensure source tables exist in the same space
   - Check table names for typos

## Supported Model Types

- Local Tables
- Remote Tables
- Views
- Analytic Models
- Data Flows
- Replication Flows
- Transformation Flows
- Data Access Controls
- Business Entities
- Fact Models
- Consumption Models
- Intelligent Lookups
- Ontologies
- Contexts
- Types
- Services
