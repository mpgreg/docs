---
title: "Orchestrate dbt Core jobs with the Astro dbt provider"
sidebar_label: "dbt Core"
id: airflow-dbt
sidebar_custom_props: { icon: 'img/integrations/dbt.png' }
---

<head>
  <meta name="description" content="Learn how to use the Astro dbt provider to orchestrate dbt Core jobs with Airflow." />
  <meta name="og:description" content="Learn how to use the  Astro dbt provider to orchestrate dbt Core jobs with Airflow." />
</head>

import CodeBlock from '@theme/CodeBlock';
import cosmos_dag from '!!raw-loader!../code-samples/dags/airflow-dbt/cosmos_dag.py';
import airflow_dbt_bashoperator from '!!raw-loader!../code-samples/dags/airflow-dbt/airflow_dbt_bashoperator.py';
import airflow_dbt_model from '!!raw-loader!../code-samples/dags/airflow-dbt/airflow_dbt_model.py';

[dbt Core](https://docs.getdbt.com/) is an open-source library for analytics engineering that helps users build interdependent SQL models for in-warehouse data transformation, using ephemeral compute of data warehouses. 

The [Astro dbt provider](https://astronomer.github.io/astronomer-cosmos/), also known as Cosmos, allows you to automatically create Airflow tasks from dbt models, seamlessly integrating dbt jobs into your Airflow orchestration environment. Running dbt Core with Airflow allows you implement event-based scheduling of dbt and integrate with other tools in your data ecosystem, while maintaining full observability of dbt model runs from the Airflow UI.

For a tutorial on how to use dbt Cloud with Airflow see [Orchestrate dbt Cloud with Airflow](airflow-dbt-cloud.md).

:::info

The full Astro project used in this tutorial can be cloned from [this repository](https://github.com/astronomer/astro-dbt-provider-tutorial-example). 

:::

## Time to complete

This tutorial takes approximately 1 hour to complete.

## Assumed knowledge

To get the most out of this tutorial, make sure you have an understanding of:

- The basics of dbt Core. See [What is dbt?](https://docs.getdbt.com/docs/introduction).
- Airflow fundamentals, such as writing DAGs and defining tasks. See [Get started with Apache Airflow](get-started-with-airflow.md).
- Airflow operators. See [Operators 101](what-is-an-operator.md).
- Airflow task groups. See [Airflow task groups](task-groups.md).

## Prerequisites

- The [Astro CLI](https://docs.astronomer.io/astro/cli/overview).
- Access to a data warehouse supported by dbt Core. See [dbt documentation](https://docs.getdbt.com/docs/supported-data-platforms) for all supported warehouses. This tutorial uses a local [PostgreSQL](https://www.postgresql.org/) database.

You do not need to have dbt Core installed locally in order to complete this tutorial.

## Step 1: Configure your Astro project

An Astro project contains all of the files you need to run Airflow locally.

1. Create a new Astro project:

    ```sh
    $ mkdir astro-dbt-core-tutorial && cd astro-dbt-core-tutorial
    $ astro dev init
    ```

2. Open the `Dockerfile` in your Astro project directory and add the following lines to the end of the file:

    ```text
    # install dbt into a virtual environment
    # replace dbt-postgres with another supported adapter if you're using a different warehouse type
    RUN python -m venv dbt_venv && source dbt_venv/bin/activate && \
    pip install --no-cache-dir dbt-postgres && deactivate
    ```

    This code runs a bash command when the Docker image is built that creates a virtual environment called `dbt_venv` inside of the Astro CLI scheduler container. The `dbt-postgres` package, which also contains `dbt-core`, is installed in the virtual environment. If you are using a different data warehouse, replace `dbt-postgres` with the adapter package for your data warehouse.

3. Add the [Astro dbt provider package](https://github.com/astronomer/astronomer-cosmos) and the [Astro Python SDK](https://astro-sdk-python.readthedocs.io/en/stable/index.html) to your Astro project `requirements.txt` file. This tutorial uses the Astro Python SDK to load and analyze data transformed by dbt.

    ```text
    astronomer-cosmos
    astro-sdk-python
    ```

4. Define the following environment variable in the `.env` file in order to be able to use the Astro Python SDK:

    ```text
    AIRFLOW__CORE__ALLOWED_DESERIALIZATION_CLASSES = airflow\.* astro\.*
    ```

## Step 2: Prepare the data

This tutorial uses an Airflow DAG to orchestrate dbt Core jobs that calculate the percentage of solar and renewable energy capacity in different years for a selected country.

1. [Download the CSV file](https://github.com/astronomer/learn-tutorials-data/blob/main/subset_energy_capacity.csv) from GitHub.
2. Save the downloaded CSV file in the `include` directory of your Astro project.

This tutorial uses a subset of the original data. The full data source provided by Open Power System Data can be found [here](https://doi.org/10.25832/national_generation_capacity/2020-10-01).

## Step 3: Prepare your data warehouse

In your data warehouse, create a new database called `energy_db` with a schema called `energy_schema`. If you are using [`psql`](https://www.postgresguide.com/utilities/psql/) with a Postgres database, use the commands below:

```sql
CREATE DATABASE energy_db;
\connect energy_db
CREATE SCHEMA energy_schema;
```

If you are using a different data warehouse, your commands to create the database and schema may differ.

## Step 4: Create your dbt models

In this tutorial we will use an example dbt job that consists of two dbt models. The first model, called `select_country`, will get the data for a selected country. The second model, called `create_pct`, will use the table created by the first model to calculate the percentage of renewable and solar energy capacity in that country.

1. Create a folder called `dbt` in your `dags` folder. 

2. In the `dbt` folder, create a folder called `my_energy_project`.

3. In the `my_energy_project` folder, create a YAML file called `dbt_project.yml`. Add the following YAML configuration to the file. This will be used to create a dbt project called `my_energy_project`.

    ```yml
    name: 'my_energy_project'

    config-version: 2
    version: '0.1'

    model-paths: ["models"]
    seed-paths: ["seeds"]
    test-paths: ["tests"]
    analysis-paths: ["analysis"]
    macro-paths: ["macros"]

    target-path: "target"
    clean-targets:
        - "target"
        - "dbt_modules"
        - "logs"

    require-dbt-version: [">=1.0.0", "<2.0.0"]

    models:
      my_energy_project:
        materialized: table

    # create a variable called country_code and give it the default value "FR" (for France)
    vars:
      country_code: "FR"
    ```

4. In `my_energy_project`, create a folder called `models`.

5. Create a SQL file named `select_country.sql` in the `models` folder. Copy the following dbt model into the file. The country for which data will be retrieved is determined by the `country_code` variable which you'll inject from your Airflow DAG.

    ```sql
    select 
        "YEAR", "COUNTRY", "SOLAR_CAPACITY", "TOTAL_CAPACITY", "RENEWABLES_CAPACITY"
    from energy_db.energy_schema.energy
    where "COUNTRY" = '{{ var("country_code") }}'
    ```

6. Create a SQL file named `create_pct.sql` in the `models` folder. Copy the following dbt model into the file:

    ```sql
    select 
        "YEAR", "COUNTRY", "SOLAR_CAPACITY", "TOTAL_CAPACITY", "RENEWABLES_CAPACITY",
        "SOLAR_CAPACITY" / "TOTAL_CAPACITY" AS "SOLAR_PCT",
        "RENEWABLES_CAPACITY" / "TOTAL_CAPACITY" AS "RENEWABLES_PCT"
    from {{ ref('select_country') }}
    where "TOTAL_CAPACITY" is not NULL
    ```

:::info

If you are using a different data warehouse than Postgres you might need to adapt the SQL dialect in the dbt models.

:::

You should now have the following structure within your Astro project:

```text
.
└── dags
│   └── dbt
│       └── my_energy_project
│          ├── dbt_project.yml
│          └── models
│              ├── select_country.sql
│              └── create_pct.sql
└── include
    └── subset_energy_capacity.csv
```

## Step 5: Configure a data warehouse connection

1. Start Airflow by running `astro dev start`.

2. In the Airflow UI, go to **Admin** -> **Connections** and click **+**. 

3. Create a new connection named `db_conn`. Select the connection type and supplied parameters based on the data warehouse you are using. For a Postgres connection, enter the following information:

    - **Connection ID**: `db_conn`.
    - **Connection Type**: `Postgres`.
    - **Host**: Your Postgres host address.
    - **Schema**: Your Postgres database (`energy_db`). 
    - **Login**: Your Postgres login username.
    - **Password**: Your Postgres password.
    - **Port**: Your Postgres port.

:::info

If a connection type for your database isn't available, you might need to make it available by adding the [relevant provider package](https://registry.astronomer.io/) to `requirements.txt` and running `astro dev restart`.

:::

## Step 6: Write your Airflow DAG

The DAG you'll write uses the Astro dbt provider to create tasks from existing dbt models and embeds those tasks within other actions in your data ecosystem.

1. In your `dags` folder, create a file called `my_energy_dag`.

2. Copy and paste the following DAG code into the file:

    <CodeBlock language="python">{cosmos_dag}</CodeBlock>

    This DAG consists of two tasks and one task group:

    - The `load_file` task uses the [Astro Python SDK `load file` operator](https://astro-sdk-python.readthedocs.io/en/stable/astro/sql/operators/load_file.html) to load the contents of the local CSV file into the data warehouse.
    - The `transform_data` task group is created from the dbt models. Using the models defined in Step 4, the task group will contain two nested task groups with two tasks each, one for `dbt run`, the other for `dbt test`.
    - The `log_data_analysis` task uses the [Astro Python SDK dataframe operator](https://astro-sdk-python.readthedocs.io/en/stable/astro/sql/operators/dataframe.html) to run an analysis on the final table using `pandas` and logs the results.

    The `DbtTaskGroup` function of the Astro dbt provider package automatically scans the `dbt` folder for dbt projects and creates a task group (`transform_data` in this example) containing Airflow tasks for running and testing your dbt models. Additionally, the provider can infer dependencies within the dbt project and will set your Airflow task dependencies accordingly.

3. (Optional) Choose which country's data to analyze by specifying your desired `country_code` in the `dbt_args` parameter of the DbtTaskGroup. See the [dataset](https://github.com/astronomer/learn-tutorials-data/blob/main/subset_energy_capacity.csv) for all available country codes.


4. Run the DAG manually by clicking the play button and view the DAG in the graph view. Double click the task groups in order to expand them and see all tasks. 

    ![Cosmos DAG graph view](/img/guides/cosmos_dag_graph_view.png)

5. Open the logs of the `log_data_analysis` task to see the proportional solar and renewable energy capacity development in the country you selected.

    ![Energy Analysis logs](/img/guides/cosmos_energy_analysis_logs.png)


:::info

The DbtTaskGroup class populates an Airflow task group with Airflow tasks created from dbt models inside of a normal DAG. To directly define a full DAG containing only dbt models use the `DbtDag` class, as shown in the [Astro dbt provider documentation](https://astronomer.github.io/astronomer-cosmos/dbt/usage.html#full-dag).

:::


## Alternative ways to run dbt Core with Airflow

While using the Astro dbt provider is recommended, there are several other ways to run dbt Core with Airflow.

### Using the BashOperator

You can use the [BashOperator](https://registry.astronomer.io/providers/apache-airflow/modules/bashoperator) to execute specific dbt commands. It's recommended to run `dbt-core` and the dbt adapter for your database in a virtual environment because there often are dependency conflicts between dbt and other packages.

The DAG below uses the BashOperator to activate the virtual environment and execute `dbt_run` for a dbt project.

<CodeBlock language="python">{airflow_dbt_bashoperator}</CodeBlock>

Using the `BashOperator` to run `dbt run` and other dbt commands can be useful during development. However, running dbt at the project level has a couple of issues:

- There is low observability into what execution state the project is in.
- Failures are absolute and require all models in a project to be run again, which can be costly.

### Using a manifest file

Using a dbt-generated `manifest.json` file gives you more visibility into the steps dbt is running in each task. This file is generated in the target directory of your `dbt` project and contains its full representation. For more information on this file, see the [dbt documentation](https://docs.getdbt.com/reference/dbt-artifacts/).

You can learn more about a manifest-based dbt and Airflow project structure, view example code, and read about the `DbtDagParser` in a 3-part blog post series on [Building a Scalable Analytics Architecture With Airflow and dbt](https://www.astronomer.io/blog/airflow-dbt-1/). 

## Conclusion

Congratulations! You've run a DAG using the Astro dbt provider to automatically create tasks from dbt models. The Astro dbt provider is under active development. You can learn more about it in the [Astro dbt provider documentation](https://astronomer.github.io/astronomer-cosmos/index.html).

