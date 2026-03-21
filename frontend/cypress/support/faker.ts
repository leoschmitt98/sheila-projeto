import { fakerPT_BR as faker } from "@faker-js/faker";

export type ClienteFake = {
  nome: string;
  telefone: string;
};

export type OrdemServicoFake = {
  clienteNome: string;
  clienteTelefone: string;
  marca: string;
  modelo: string;
  defeito: string;
  estadoEntrada: string;
  valorMaoObra: number;
  valorMaterial: number;
  previsaoEntrega: string;
};

export type AgendamentoFake = {
  clienteNome: string;
  clienteTelefone: string;
  data: string;
};

export function gerarTelefone() {
  const ddd = faker.helpers.arrayElement([
    "11",
    "21",
    "31",
    "41",
    "51",
    "61",
  ]);
  const numero = faker.string.numeric(9);
  return `${ddd}${numero}`;
}

export function gerarCliente(): ClienteFake {
  return {
    nome: faker.person.fullName(),
    telefone: gerarTelefone(),
  };
}

export function gerarOS(): OrdemServicoFake {
  const cliente = gerarCliente();
  const maoObra = Number(faker.number.float({ min: 80, max: 300, fractionDigits: 2 }).toFixed(2));
  const material = Number(faker.number.float({ min: 0, max: 250, fractionDigits: 2 }).toFixed(2));

  return {
    clienteNome: cliente.nome,
    clienteTelefone: cliente.telefone,
    marca: faker.helpers.arrayElement(["Samsung", "Apple", "Motorola", "Xiaomi"]),
    modelo: `${faker.helpers.arrayElement(["A54", "iPhone 12", "G84", "Redmi Note 13"])} ${faker.string.alphanumeric(3).toUpperCase()}`,
    defeito: faker.helpers.arrayElement([
      "Nao liga",
      "Tela quebrada",
      "Nao carrega",
      "Sem audio",
      "Reiniciando sozinho",
    ]),
    estadoEntrada: faker.helpers.arrayElement([
      "Com marcas de uso",
      "Boa conservacao",
      "Com trinca frontal",
      "Sem danos aparentes",
    ]),
    valorMaoObra: maoObra,
    valorMaterial: material,
    previsaoEntrega: faker.date.soon({ days: 7 }).toISOString().slice(0, 10),
  };
}

export function gerarAgendamento(): AgendamentoFake {
  const cliente = gerarCliente();
  const data = faker.date.soon({ days: 14 }).toISOString().slice(0, 10);
  return {
    clienteNome: cliente.nome,
    clienteTelefone: cliente.telefone,
    data,
  };
}

