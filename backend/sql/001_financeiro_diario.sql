/*
  Tabela de consolidado financeiro diário por empresa.
  - Guarda receita concluída por dia.
  - Permite histórico financeiro sem depender de manter todos os agendamentos antigos.
*/

IF OBJECT_ID('dbo.FinanceiroDiario', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.FinanceiroDiario (
    Id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    EmpresaId INT NOT NULL,
    DataRef DATE NOT NULL,
    QtdConcluidos INT NOT NULL CONSTRAINT DF_FinanceiroDiario_Qtd DEFAULT(0),
    ReceitaConcluida DECIMAL(12,2) NOT NULL CONSTRAINT DF_FinanceiroDiario_Receita DEFAULT(0),
    AtualizadoEm DATETIME2(0) NOT NULL CONSTRAINT DF_FinanceiroDiario_Atualizado DEFAULT(SYSUTCDATETIME()),

    CONSTRAINT UQ_FinanceiroDiario_Empresa_Data UNIQUE (EmpresaId, DataRef),
    CONSTRAINT CK_FinanceiroDiario_Qtd CHECK (QtdConcluidos >= 0),
    CONSTRAINT CK_FinanceiroDiario_Receita CHECK (ReceitaConcluida >= 0)
  );

  CREATE INDEX IX_FinanceiroDiario_Empresa_DataRef
    ON dbo.FinanceiroDiario (EmpresaId, DataRef);
END
GO

/*
  Backfill inicial a partir dos agendamentos já concluídos.
*/
;WITH Agg AS (
  SELECT
    a.EmpresaId,
    CONVERT(date, a.DataAgendada) AS DataRef,
    COUNT(1) AS QtdConcluidos,
    SUM(ISNULL(es.Preco, 0)) AS ReceitaConcluida
  FROM dbo.Agendamentos a
  LEFT JOIN dbo.EmpresaServicos es
    ON es.EmpresaId = a.EmpresaId
   AND es.Id = a.ServicoId
  WHERE LTRIM(RTRIM(a.Status)) = N'completed'
  GROUP BY a.EmpresaId, CONVERT(date, a.DataAgendada)
)
MERGE dbo.FinanceiroDiario AS target
USING Agg AS src
  ON target.EmpresaId = src.EmpresaId
 AND target.DataRef = src.DataRef
WHEN MATCHED THEN
  UPDATE SET
    target.QtdConcluidos = src.QtdConcluidos,
    target.ReceitaConcluida = src.ReceitaConcluida,
    target.AtualizadoEm = SYSUTCDATETIME()
WHEN NOT MATCHED BY TARGET THEN
  INSERT (EmpresaId, DataRef, QtdConcluidos, ReceitaConcluida, AtualizadoEm)
  VALUES (src.EmpresaId, src.DataRef, src.QtdConcluidos, src.ReceitaConcluida, SYSUTCDATETIME());
GO
