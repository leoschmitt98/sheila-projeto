/*
  Seed de agendamentos do mês passado para testes de faturamento.
  Alvo padrão: EmpresaId = 3 ("meu barbeiro").

  O script:
  1) valida empresa e serviços
  2) insere clientes de teste
  3) cria atendimentos e agendamentos no mês passado
  4) recalcula FinanceiroDiario do mês passado para a empresa

  Observação:
  - Pode ser executado mais de uma vez; cada execução adiciona novos registros de teste.
*/

SET NOCOUNT ON;

DECLARE @EmpresaId INT = 3;
DECLARE @EmpresaNomeEsperado NVARCHAR(120) = N'meu barbeiro';
DECLARE @QtdAgendamentos INT = 24;

DECLARE @InicioMesPassado DATE = DATEFROMPARTS(YEAR(DATEADD(MONTH, -1, GETDATE())), MONTH(DATEADD(MONTH, -1, GETDATE())), 1);
DECLARE @FimMesPassado DATE = EOMONTH(DATEADD(MONTH, -1, GETDATE()));

IF NOT EXISTS (
  SELECT 1
  FROM dbo.Empresas e
  WHERE e.Id = @EmpresaId
)
BEGIN
  THROW 51000, 'EmpresaId informado não existe.', 1;
END;

IF NOT EXISTS (
  SELECT 1
  FROM dbo.Empresas e
  WHERE e.Id = @EmpresaId
    AND LOWER(LTRIM(RTRIM(e.Nome))) = LOWER(LTRIM(RTRIM(@EmpresaNomeEsperado)))
)
BEGIN
  PRINT 'Aviso: o nome da empresa não confere exatamente com "meu barbeiro". O script continuará pelo EmpresaId.';
END;

IF NOT EXISTS (
  SELECT 1
  FROM dbo.EmpresaServicos es
  WHERE es.EmpresaId = @EmpresaId
)
BEGIN
  THROW 51001, 'A empresa não possui serviços cadastrados em dbo.EmpresaServicos.', 1;
END;

IF OBJECT_ID('tempdb..#ServicosEmpresa') IS NOT NULL DROP TABLE #ServicosEmpresa;
CREATE TABLE #ServicosEmpresa (
  RowNum INT NOT NULL PRIMARY KEY,
  ServicoId INT NOT NULL,
  Nome NVARCHAR(200) NOT NULL,
  DuracaoMin INT NOT NULL
);

INSERT INTO #ServicosEmpresa (RowNum, ServicoId, Nome, DuracaoMin)
SELECT
  ROW_NUMBER() OVER (ORDER BY es.Id) AS RowNum,
  es.Id,
  LTRIM(RTRIM(es.Nome)) AS Nome,
  CASE WHEN ISNULL(es.DuracaoMin, 0) <= 0 THEN 30 ELSE es.DuracaoMin END AS DuracaoMin
FROM dbo.EmpresaServicos es
WHERE es.EmpresaId = @EmpresaId;

DECLARE @QtdServicos INT = (SELECT COUNT(1) FROM #ServicosEmpresa);

IF OBJECT_ID('tempdb..#Seed') IS NOT NULL DROP TABLE #Seed;
CREATE TABLE #Seed (
  Seq INT NOT NULL PRIMARY KEY,
  DataAgendada DATE NOT NULL,
  HoraAgendada TIME(0) NOT NULL,
  ClienteNome NVARCHAR(120) NOT NULL,
  ClienteTelefone NVARCHAR(30) NOT NULL,
  Observacoes NVARCHAR(200) NULL,
  StatusAgendamento NVARCHAR(40) NOT NULL
);

;WITH N AS (
  SELECT TOP (@QtdAgendamentos)
    ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) - 1 AS n
  FROM sys.all_objects
),
Base AS (
  SELECT
    n + 1 AS Seq,
    DATEADD(DAY, n % (DATEDIFF(DAY, @InicioMesPassado, @FimMesPassado) + 1), @InicioMesPassado) AS DataAgendada,
    CASE (n % 8)
      WHEN 0 THEN CAST('09:00:00' AS TIME(0))
      WHEN 1 THEN CAST('09:15:00' AS TIME(0))
      WHEN 2 THEN CAST('10:00:00' AS TIME(0))
      WHEN 3 THEN CAST('10:45:00' AS TIME(0))
      WHEN 4 THEN CAST('13:00:00' AS TIME(0))
      WHEN 5 THEN CAST('14:30:00' AS TIME(0))
      WHEN 6 THEN CAST('16:00:00' AS TIME(0))
      ELSE CAST('17:15:00' AS TIME(0))
    END AS HoraAgendada,
    CONCAT(N'Cliente Teste ', FORMAT(n + 1, '00')) AS ClienteNome,
    CONCAT('551199900', RIGHT(CONCAT('00', CAST(n + 1 AS VARCHAR(4))), 2)) AS ClienteTelefone,
    N'Seed automático para testes de faturamento' AS Observacoes,
    CASE
      WHEN (n % 10) IN (0, 7) THEN N'confirmed'
      WHEN (n % 10) = 8 THEN N'pending'
      WHEN (n % 10) = 9 THEN N'cancelled'
      ELSE N'completed'
    END AS StatusAgendamento
  FROM N
)
INSERT INTO #Seed (Seq, DataAgendada, HoraAgendada, ClienteNome, ClienteTelefone, Observacoes, StatusAgendamento)
SELECT Seq, DataAgendada, HoraAgendada, ClienteNome, ClienteTelefone, Observacoes, StatusAgendamento
FROM Base;

DECLARE @TemColunaProfissionalId BIT = CASE WHEN COL_LENGTH('dbo.Agendamentos', 'ProfissionalId') IS NULL THEN 0 ELSE 1 END;

DECLARE @Seq INT = 1;
DECLARE @Data DATE;
DECLARE @Hora TIME(0);
DECLARE @ClienteNome NVARCHAR(120);
DECLARE @ClienteTelefone NVARCHAR(30);
DECLARE @Observacoes NVARCHAR(200);
DECLARE @Status NVARCHAR(40);
DECLARE @ServicoRow INT;
DECLARE @ServicoId INT;
DECLARE @ServicoNome NVARCHAR(200);
DECLARE @DuracaoMin INT;
DECLARE @ClienteId INT;
DECLARE @AtendimentoId INT;
DECLARE @InicioEm DATETIME2(0);
DECLARE @FimEm DATETIME2(0);

WHILE @Seq <= @QtdAgendamentos
BEGIN
  SELECT
    @Data = s.DataAgendada,
    @Hora = s.HoraAgendada,
    @ClienteNome = s.ClienteNome,
    @ClienteTelefone = s.ClienteTelefone,
    @Observacoes = s.Observacoes,
    @Status = s.StatusAgendamento
  FROM #Seed s
  WHERE s.Seq = @Seq;

  SET @ServicoRow = ((@Seq - 1) % @QtdServicos) + 1;

  SELECT
    @ServicoId = se.ServicoId,
    @ServicoNome = se.Nome,
    @DuracaoMin = se.DuracaoMin
  FROM #ServicosEmpresa se
  WHERE se.RowNum = @ServicoRow;

  SELECT @ClienteId = c.Id
  FROM dbo.Clientes c
  WHERE c.EmpresaId = @EmpresaId
    AND c.Whatsapp = @ClienteTelefone;

  IF @ClienteId IS NULL
  BEGIN
    INSERT INTO dbo.Clientes (EmpresaId, Nome, Whatsapp)
    VALUES (@EmpresaId, @ClienteNome, @ClienteTelefone);

    SET @ClienteId = SCOPE_IDENTITY();
  END
  ELSE
  BEGIN
    UPDATE dbo.Clientes
    SET Nome = @ClienteNome
    WHERE Id = @ClienteId;
  END;

  SET @InicioEm = DATEADD(SECOND, DATEDIFF(SECOND, '00:00:00', @Hora), CAST(@Data AS DATETIME2(0)));
  SET @FimEm = DATEADD(MINUTE, @DuracaoMin, @InicioEm);

  INSERT INTO dbo.Atendimentos
    (EmpresaId, ClienteId, InicioAtendimento, FimAtendimento, Status, Canal)
  VALUES
    (@EmpresaId, @ClienteId, @InicioEm, @FimEm, @Status, N'chat');

  SET @AtendimentoId = SCOPE_IDENTITY();

  IF @TemColunaProfissionalId = 1
  BEGIN
    INSERT INTO dbo.Agendamentos
      (EmpresaId, AtendimentoId, ServicoId, Servico, DataAgendada, HoraAgendada, DuracaoMin, InicioEm, FimEm, Status, Observacoes, ClienteNome, ClienteTelefone, ProfissionalId)
    VALUES
      (@EmpresaId, @AtendimentoId, @ServicoId, @ServicoNome, @Data, @Hora, @DuracaoMin, @InicioEm, @FimEm, @Status, @Observacoes, @ClienteNome, @ClienteTelefone, NULL);
  END
  ELSE
  BEGIN
    INSERT INTO dbo.Agendamentos
      (EmpresaId, AtendimentoId, ServicoId, Servico, DataAgendada, HoraAgendada, DuracaoMin, InicioEm, FimEm, Status, Observacoes, ClienteNome, ClienteTelefone)
    VALUES
      (@EmpresaId, @AtendimentoId, @ServicoId, @ServicoNome, @Data, @Hora, @DuracaoMin, @InicioEm, @FimEm, @Status, @Observacoes, @ClienteNome, @ClienteTelefone);
  END;

  SET @Seq += 1;
END;

IF OBJECT_ID('dbo.FinanceiroDiario', 'U') IS NOT NULL
BEGIN
  ;WITH ReceitaPorDia AS (
    SELECT
      a.EmpresaId,
      a.DataAgendada AS DataRef,
      COUNT(1) AS QtdConcluidos,
      SUM(
        CASE
          WHEN COL_LENGTH('dbo.Agendamentos', 'ValorFinal') IS NOT NULL
            THEN ISNULL(a.ValorFinal, ISNULL(es.Preco, 0))
          ELSE ISNULL(es.Preco, 0)
        END
      ) AS ReceitaConcluida
    FROM dbo.Agendamentos a
    LEFT JOIN dbo.EmpresaServicos es
      ON es.EmpresaId = a.EmpresaId
     AND es.Id = a.ServicoId
    WHERE a.EmpresaId = @EmpresaId
      AND a.DataAgendada BETWEEN @InicioMesPassado AND @FimMesPassado
      AND LTRIM(RTRIM(a.Status)) = N'completed'
    GROUP BY a.EmpresaId, a.DataAgendada
  )
  MERGE dbo.FinanceiroDiario AS target
  USING ReceitaPorDia AS src
  ON target.EmpresaId = src.EmpresaId AND target.DataRef = src.DataRef
  WHEN MATCHED THEN
    UPDATE SET
      target.QtdConcluidos = src.QtdConcluidos,
      target.ReceitaConcluida = src.ReceitaConcluida,
      target.AtualizadoEm = SYSUTCDATETIME()
  WHEN NOT MATCHED THEN
    INSERT (EmpresaId, DataRef, QtdConcluidos, ReceitaConcluida, AtualizadoEm)
    VALUES (src.EmpresaId, src.DataRef, src.QtdConcluidos, src.ReceitaConcluida, SYSUTCDATETIME());

  DELETE fd
  FROM dbo.FinanceiroDiario fd
  WHERE fd.EmpresaId = @EmpresaId
    AND fd.DataRef BETWEEN @InicioMesPassado AND @FimMesPassado
    AND NOT EXISTS (
      SELECT 1
      FROM dbo.Agendamentos a
      WHERE a.EmpresaId = fd.EmpresaId
        AND a.DataAgendada = fd.DataRef
        AND LTRIM(RTRIM(a.Status)) = N'completed'
    );
END;

SELECT
  @EmpresaId AS EmpresaId,
  @InicioMesPassado AS InicioMesPassado,
  @FimMesPassado AS FimMesPassado,
  COUNT(1) AS AgendamentosInseridos,
  SUM(CASE WHEN StatusAgendamento = N'completed' THEN 1 ELSE 0 END) AS QtdCompleted,
  SUM(CASE WHEN StatusAgendamento = N'confirmed' THEN 1 ELSE 0 END) AS QtdConfirmed,
  SUM(CASE WHEN StatusAgendamento = N'pending' THEN 1 ELSE 0 END) AS QtdPending,
  SUM(CASE WHEN StatusAgendamento = N'cancelled' THEN 1 ELSE 0 END) AS QtdCancelled
FROM #Seed;

SELECT TOP 50
  a.Id,
  a.DataAgendada,
  a.HoraAgendada,
  a.Servico,
  a.Status,
  a.ClienteNome,
  a.ClienteTelefone
FROM dbo.Agendamentos a
WHERE a.EmpresaId = @EmpresaId
  AND a.DataAgendada BETWEEN @InicioMesPassado AND @FimMesPassado
ORDER BY a.DataAgendada DESC, a.HoraAgendada DESC;
