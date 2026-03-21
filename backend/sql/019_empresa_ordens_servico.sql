IF OBJECT_ID('dbo.EmpresaOrdensServico', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.EmpresaOrdensServico (
    Id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    EmpresaId INT NOT NULL,
    ClienteNome NVARCHAR(160) NOT NULL,
    ClienteTelefone NVARCHAR(30) NOT NULL,
    ClienteCpf NVARCHAR(20) NULL,
    TipoAparelho NVARCHAR(40) NOT NULL,
    Marca NVARCHAR(80) NOT NULL,
    Modelo NVARCHAR(120) NOT NULL,
    Cor NVARCHAR(40) NULL,
    ImeiSerial NVARCHAR(120) NULL,
    Acessorios NVARCHAR(300) NULL,
    SenhaPadrao NVARCHAR(120) NULL,
    EstadoEntrada NVARCHAR(1000) NOT NULL,
    DefeitoRelatado NVARCHAR(2000) NOT NULL,
    ObservacoesTecnicas NVARCHAR(2000) NULL,
    ValorMaoObra DECIMAL(12,2) NOT NULL
      CONSTRAINT DF_EmpresaOrdensServico_ValorMaoObra DEFAULT(0),
    ValorPecas DECIMAL(12,2) NOT NULL
      CONSTRAINT DF_EmpresaOrdensServico_ValorPecas DEFAULT(0),
    ValorTotal DECIMAL(12,2) NOT NULL
      CONSTRAINT DF_EmpresaOrdensServico_ValorTotal DEFAULT(0),
    PrazoEstimado NVARCHAR(120) NULL,
    StatusOrcamento NVARCHAR(40) NOT NULL
      CONSTRAINT DF_EmpresaOrdensServico_StatusOrcamento DEFAULT('aguardando_aprovacao'),
    StatusOrdem NVARCHAR(40) NOT NULL
      CONSTRAINT DF_EmpresaOrdensServico_StatusOrdem DEFAULT('aberta'),
    DataEntrada DATE NOT NULL,
    PrevisaoEntrega DATE NULL,
    ObservacoesGerais NVARCHAR(2000) NULL,
    CriadoEm DATETIME2(0) NOT NULL
      CONSTRAINT DF_EmpresaOrdensServico_CriadoEm DEFAULT(
        CAST(SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'E. South America Standard Time' AS DATETIME2(0))
      ),
    AtualizadoEm DATETIME2(0) NOT NULL
      CONSTRAINT DF_EmpresaOrdensServico_AtualizadoEm DEFAULT(
        CAST(SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'E. South America Standard Time' AS DATETIME2(0))
      )
  );
END;

IF NOT EXISTS (
  SELECT 1
  FROM sys.foreign_keys
  WHERE name = 'FK_EmpresaOrdensServico_Empresas'
)
BEGIN
  ALTER TABLE dbo.EmpresaOrdensServico
  ADD CONSTRAINT FK_EmpresaOrdensServico_Empresas
    FOREIGN KEY (EmpresaId) REFERENCES dbo.Empresas(Id);
END;

IF NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = 'IX_EmpresaOrdensServico_Empresa_DataEntrada'
    AND object_id = OBJECT_ID('dbo.EmpresaOrdensServico')
)
BEGIN
  CREATE INDEX IX_EmpresaOrdensServico_Empresa_DataEntrada
    ON dbo.EmpresaOrdensServico (EmpresaId, DataEntrada DESC, Id DESC);
END;

IF NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = 'IX_EmpresaOrdensServico_Empresa_Status'
    AND object_id = OBJECT_ID('dbo.EmpresaOrdensServico')
)
BEGIN
  CREATE INDEX IX_EmpresaOrdensServico_Empresa_Status
    ON dbo.EmpresaOrdensServico (EmpresaId, StatusOrdem, Id DESC);
END;
